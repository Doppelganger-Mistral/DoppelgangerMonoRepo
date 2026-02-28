import os
import csv
import random
from dotenv import load_dotenv
from mistralai import Mistral

# Load environment variables
load_dotenv()

# Initialize Mistral Client
api_key = os.getenv("MISTRAL_API_KEY")
client = Mistral(api_key=api_key)
MODEL = "mistral-large-latest"

# --- LOAD SCENARIOS FROM CSV ---

def load_combos(filepath="data_creation/final_location_scenario_combos.csv"):
    combos = []
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            combos.append((row["Location"].strip(), row["Scenario"].strip()))
    return combos

# --- PROMPT ---

HOOK_SYSTEM_PROMPT = """You are the Game Master for a social party game where players impersonate their friends.

Given a Location and Scenario, write exactly 2 sentences:
- Sentence 1: one short line placing the group in an interesting situation. A scenario where a loudmouth, a pushover, and a bullshitter all answer differently. ONE detail only — don't stack.
- "the group" or "they" only — never "you".
- Sentence 2: a short personal question in quotes that asks the individual about their action given their predicament. 
- Sentence 1 should be brief. If you're adding a second clause or extra detail, cut it.

THE GOLDEN RULE: The question must place the group in a scenario where they are prompted to respond with their next action. 

<examples>
<example>
<location>Airport</location>
<scenario>Attempting to smuggle stolen jewels</scenario>
<bad>The group is frozen at the scanner while a TSA agent slowly lifts a 4kg bag of shimmering jewels and artifacts that shine like stars. "What do you do?"</bad>
<bad_reason>Too many details stacked into sentence 1 — "frozen at the scanner", "slowly lifts", "4kg", "that shine like stars". Over-written.</bad_reason>
<good>A TSA agent finds a large bag of jewels in your luggage. "What's your next move?"</good>
</example>
<example>
<location>Black-Tie Event</location>
<scenario>Starting a Fight</scenario>
<bad>The group is at the Australian Ballet Foundation gala when a scuffle breaks out near the canapés and they're somehow in the middle of it as Hugh Jackman watches. The coordinator says, "Was this you?"</bad>
<bad_reason>Too many details crammed into sentence 1 — gala name, scuffle location, celebrity reaction.</bad_reason>
<good>You hear men yelling in the background followed by a sudden roar of shattered glass, it's an all out brawl. "What do you do?"</good>
</example>
</examples>

2 sentences only. Keep sentence 1 short."""


# --- HELPER ---

def generate_ai_response(system_prompt, user_prompt, temperature=0.95):
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_prompt},
    ]
    try:
        response = client.chat.complete(
            model=MODEL,
            temperature=temperature,
            messages=messages
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"[AI Generation Error]: {e}"


# --- MAIN GAME LOOP ---

def get_next_prompt():
    # Load combos
    try:
        combos = load_combos()
        print(f"Loaded {len(combos)} location/scenario combos.\n")
    except FileNotFoundError:
        print("ERROR: Could not find data_creation/final_location_scenario_combos.csv")
        return

    # Pick a fresh random combo
    location, scenario = random.choice(combos)
    print(f"[Location: {location} | Scenario: {scenario}]\n")

    # Generate the hook
    hook_user_prompt = f"<location>{location}</location>\n<scenario>{scenario}</scenario>\nGenerate the scene now."
    print("Generating scenario...")
    hook = generate_ai_response(HOOK_SYSTEM_PROMPT, hook_user_prompt)
    print(f"\nGame Master: {hook}\n")
    return hook
