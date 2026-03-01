# Settings
https://onestopforwriters.com/scene_settings
https://shopwritershelpingwriters.net/pages/list-of-urban-settings
https://www.enchantedlearning.com/wordlist/story-settings.shtml

# Conflicts
https://onestopforwriters.com/character_conflicts
https://www.servicescape.com/blog/120-story-conflict-ideas-and-examples
https://shopwritershelpingwriters.net/pages/list-of-conflict-scenarios-vol-1

# What we did

### Settings
- Scrape and combine all the settings from the websites above
- Deduplicate
- Manually quality check each setting to get the final list

### Conflicts
- Scrape and combine all the conflicts from the websites above
- Added additional AI Generated scenrios based on examples
- Deduplicate
- Manually quality check each conflict to get the final list

### Embedding
- With the filtered list we add contextual embedding to imporve the quality of the embedding
- Then we embedded all the the locations and scnerarios
- After embedding we did a cosine similarity match and listed all the combinations in a CSV

### Final Selection
- After sorting by embedding score/similarity, we removed the top 500 as they were too boring
- We also removed everything under the top 35000 as it started to become incoherrent at times
- We also removed the top 500 as they were too boring
- That leaves us with a dataset of 7000 wonderful combinations that have the perfect balance of chaos and logic