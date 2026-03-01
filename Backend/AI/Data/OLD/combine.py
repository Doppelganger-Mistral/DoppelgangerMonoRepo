import os
import pandas as pd
import numpy as np
from mistralai import Mistral
from dotenv import load_dotenv
from scipy.spatial.distance import cosine

# 1. Setup
load_dotenv()
api_key = os.environ.get("MISTRAL_API_KEY")
model = "mistral-embed"
client = Mistral(api_key=api_key)

def get_embeddings_batched(texts, batch_size=50):
    """Fetches embeddings in chunks to avoid API limits."""
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        print(f"Embedding batch {i//batch_size + 1}...")
        response = client.embeddings.create(model=model, inputs=batch)
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings

# 2. Load Full Data
# Using 'sep=None' and 'engine=python' to automatically handle commas/tabs safely
try:
    loc_df = pd.read_csv('locations.csv', header=None, sep=None, engine='python')
    sce_df = pd.read_csv('scenarios.csv', header=None, sep=None, engine='python')
    locations = loc_df[0].dropna().astype(str).tolist()
    scenarios = sce_df[0].dropna().astype(str).tolist()
except Exception as e:
    print(f"Pandas load failed, falling back to line-reader: {e}")
    with open('locations.csv', 'r') as f: locations = [l.strip() for l in f if l.strip()]
    with open('scenarios.csv', 'r') as f: scenarios = [l.strip() for l in f if l.strip()]

print(f"Loaded {len(locations)} locations and {len(scenarios)} scenarios.")
print(f"Total combinations to calculate: {len(locations) * len(scenarios):,}")

# 3. Embed Unique Items
print("\n--- Generating Embeddings ---")
loc_embeddings = get_embeddings_batched(locations)
sce_embeddings = get_embeddings_batched(scenarios)

# Map text to vector
loc_map = dict(zip(locations, loc_embeddings))
sce_map = dict(zip(scenarios, sce_embeddings))

# 4. Cross-Compare All
print("\n--- Calculating Similarities ---")
rows = []
for loc in locations:
    for sce in scenarios:
        # Cosine Similarity Calculation
        sim = 1 - cosine(loc_map[loc], sce_map[sce])
        rows.append({
            'Location': loc,
            'Scenario': sce,
            'Similarity': round(float(sim), 4)
        })

# 5. Create DataFrame and Sort
# Sorting highest to lowest similarity
final_df = pd.DataFrame(rows)
final_df = final_df.sort_values(by='Similarity', ascending=False)

# 6. Save to CSV
output_file = 'location_scenario_matrix.csv'
final_df.to_csv(output_file, index=False)

print(f"\nSuccess! Results saved to {output_file}")
print("-" * 30)
print("Preview (Top 5):")
print(final_df.head(5))
print("\nPreview (Bottom 5):")
print(final_df.tail(5))