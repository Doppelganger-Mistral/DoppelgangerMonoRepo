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
- Sentence 1: one short line placing the group in an interesting situation. ONE detail only — don't stack.
- Sentence 2: a short NPC question in quotes — something a loudmouth, a pushover, and a bullshitter all answer differently.
- "the group" or "they" only — never "you".
- Sentence 1 should be brief. If you're adding a second clause or extra detail, cut it.

THE GOLDEN RULE: The question must  personality, not just reaction to a wild situation.

<examples>
<example>
<location>Airport</location>
<scenario>Attempting to smuggle a wheel of cheese through airport security</scenario>
<bad>The group is frozen at the scanner while a TSA agent slowly lifts a 4kg wheel of aged gouda out of someone's carry-on like it's evidence. She looks at all of them and says, "Whose bag is this?"</bad>
<bad_reason>Too many details stacked into sentence 1 — "slowly lifts", "4kg", "like it's evidence". Over-written.</bad_reason>
<good>A TSA agent is holding a wheel of gouda in the air, staring at the group. "Whose bag is this?"</good>
</example>
<example>
<location>Black-Tie Event</location>
<scenario>Starting a Bar Fight</scenario>
<bad>The group is at the Australian Ballet Foundation gala when a scuffle breaks out near the canapés and they're somehow in the middle of it as Hugh Jackman watches. The coordinator says, "Was this you?"</bad>
<bad_reason>Three details crammed into sentence 1 — gala name, scuffle location, celebrity reaction.</bad_reason>
<good>There's a brawl at a black-tie gala and Hugh Jackman is watching the group. A coordinator appears: "Was this you?"</good>
</example>
<example>
<location>War Zone</location>
<scenario>Starting a Bar Fight</scenario>
<good>The group is in an active conflict zone with, somehow, a functioning bar — and someone just knocked over a soldier's drink. He turns and says, "You got something to say?"</good>
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

def main():
    print("=== THE IMPERSONATION GM TESTER ===")

    # Load combos
    try:
        combos = load_combos()
        print(f"Loaded {len(combos)} location/scenario combos.\n")
    except FileNotFoundError:
        print("ERROR: Could not find data_creation/final_location_scenario_combos.csv")
        return

    # Player setup
    while True:
        try:
            num_players = int(input("Enter number of players (3-7): "))
            if 3 <= num_players <= 7:
                break
            print("Please enter a number between 3 and 7.")
        except ValueError:
            print("Invalid input. Please enter a number.")

    players = [f"Player {i+1}" for i in range(num_players)]

    # Game loop — each round is a completely fresh scenario
    round_num = 1
    while True:
        print(f"\n{'='*50}")
        print(f"--- ROUND {round_num} ---")

        # Pick a fresh random combo
        location, scenario = random.choice(combos)
        print(f"[Location: {location} | Scenario: {scenario}]\n")

        # Generate the hook
        hook_user_prompt = f"<location>{location}</location>\n<scenario>{scenario}</scenario>\nGenerate the scene now."
        print("Generating scenario...")
        hook = generate_ai_response(HOOK_SYSTEM_PROMPT, hook_user_prompt)
        print(f"\nGame Master: {hook}\n")

        # Player responses
        print(f"{'- '*25}")
        print("Each player responds AS THE PERSON THEY'RE IMPERSONATING:")
        print("(Sound like them — their words, their energy, their vibe)\n")

        player_responses = []
        for player in players:
            response = input(f"  {player}: ").strip()
            player_responses.append(response)

        # Show all responses
        print(f"\n--- RESPONSES ---\n")
        for i, response in enumerate(player_responses):
            print(f"  [{i + 1}] \"{response}\"")

        # Next round?
        cont = input("\nNext round? (y/n): ").strip().lower()
        if cont != "y":
            print("\n=== GAME OVER ===")
            break

        round_num += 1


if __name__ == "__main__":
    main()