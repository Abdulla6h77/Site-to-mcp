# External MCP client demo

These are selected inputs and outputs from a single signed-in Codex CLI conversation. The client used the standalone FDA MCP server over stdio. It searched for cetirizine, then passed the returned FDA article URL to both advisory tools.

The JSON excerpts omit provider run IDs and shorten the returned text for readability. The original tool responses contain the FDA announcement and warning excerpts.

## search_medicines

Input

```json
{
  "query": "cetirizine",
  "limit": 1
}
```

Selected output

```json
{
  "status": "found",
  "query": "cetirizine",
  "results": [
    {
      "title": "FDA requires warning about rare but severe itching after stopping long-term use of oral allergy medicines cetirizine or levocetirizine (Zyrtec, Xyzal, and other trade names)",
      "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fda-requires-warning-about-rare-severe-itching-after-stopping-long-term-use-oral-allergy-medicines",
      "publication_date": "2025-05-16"
    }
  ]
}
```

## get_medicine_details

Input

```json
{
  "medicine_name": "cetirizine",
  "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fda-requires-warning-about-rare-severe-itching-after-stopping-long-term-use-oral-allergy-medicines"
}
```

Selected output

```json
{
  "medicine_name": "cetirizine",
  "source": {
    "title": "FDA requires warning about rare but severe itching after stopping long-term use of oral allergy medicines cetirizine or levocetirizine (Zyrtec, Xyzal, and other trade names)",
    "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fda-requires-warning-about-rare-severe-itching-after-stopping-long-term-use-oral-allergy-medicines",
    "publication_date": "2025-05-16",
    "retrieved_at": "2026-11-15T18:23:01.488Z",
    "publisher": "U.S. Food and Drug Administration"
  },
  "announcement_excerpt": "The U.S. Food and Drug Administration (FDA) is warning that patients stopping the oral allergy medicines cetirizine (Zyr…"
}
```

## get_safety_warnings

Input

```json
{
  "medicine_name": "cetirizine",
  "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fda-requires-warning-about-rare-severe-itching-after-stopping-long-term-use-oral-allergy-medicines"
}
```

Selected output

```json
{
  "medicine_name": "cetirizine",
  "source": {
    "title": "FDA requires warning about rare but severe itching after stopping long-term use of oral allergy medicines cetirizine or levocetirizine (Zyrtec, Xyzal, and other trade names)",
    "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fda-requires-warning-about-rare-severe-itching-after-stopping-long-term-use-oral-allergy-medicines",
    "publication_date": "2025-05-16",
    "retrieved_at": "2026-11-15T18:23:48.433Z",
    "publisher": "U.S. Food and Drug Administration"
  },
  "status": "available",
  "warning_excerpt_count": 3
}
```

Reproduce the conversation using the [external-client configuration](README.md#external-client-configuration) and [demo steps](DEMO.md).
