import os
import pandas as pd
import numpy as np
import plotly.express as px
from mistralai import Mistral
from dotenv import load_dotenv
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from scipy.spatial.distance import cosine
from umap import UMAP

# 1. Setup and Initialization
load_dotenv()
api_key = os.environ.get("MISTRAL_API_KEY")
model = "mistral-embed"
client = Mistral(api_key=api_key)

def get_embeddings_batched(texts, batch_size=50):
    """Fetches embeddings in chunks to avoid API limits."""
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        print(f"Embedding batch {i//batch_size + 1} / {-(len(texts)//-batch_size)}...")
        response = client.embeddings.create(model=model, inputs=batch)
        all_embeddings.extend([item.embedding for item in response.data])
    return all_embeddings

# 2. Load Raw Data safely
try:
    loc_df = pd.read_csv('locations.csv', header=None, sep=None, engine='python')
    sce_df = pd.read_csv('scenarios.csv', header=None, sep=None, engine='python')
    raw_locations = loc_df[0].dropna().astype(str).tolist()
    raw_scenarios = sce_df[0].dropna().astype(str).tolist()
except Exception as e:
    print(f"Pandas load failed, falling back to line-reader: {e}")
    with open('locations.csv', 'r') as f: raw_locations = [l.strip() for l in f if l.strip()]
    with open('scenarios.csv', 'r') as f: raw_scenarios = [l.strip() for l in f if l.strip()]

print(f"Loaded {len(raw_locations)} locations and {len(raw_scenarios)} scenarios.")

# 3. Apply Contextual Prompting (The Magic Trick)
# We tell the model explicitly how these concepts relate to each other
context_locations = [f"This is a setting where things happen: {loc}" for loc in raw_locations]
context_scenarios = [f"This is an scenario that plays out in a setting: {sce}" for sce in raw_scenarios]

print("\n--- Generating Contextual Embeddings ---")
print("Embedding Locations...")
loc_embs = get_embeddings_batched(context_locations)
print("Embedding Scenarios...")
sce_embs = get_embeddings_batched(context_scenarios)

# 4. Calculate and Save the New Similarity Matrix
print("\n--- Calculating New Contextual Similarity Matrix ---")
rows = []
for i, loc in enumerate(raw_locations):
    for j, sce in enumerate(raw_scenarios):
        # We use the raw text for the CSV so it's readable, but use the contextual embeddings for math
        sim = 1 - cosine(loc_embs[i], sce_embs[j])
        rows.append({
            'Location': loc,
            'Scenario': sce,
            'Contextual_Similarity': round(float(sim), 4)
        })

matrix_df = pd.DataFrame(rows).sort_values(by='Contextual_Similarity', ascending=False)
matrix_filename = 'contextual_location_scenario_matrix.csv'
matrix_df.to_csv(matrix_filename, index=False)
print(f"Saved highly-optimized matrix to: {matrix_filename}")