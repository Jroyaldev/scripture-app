# Syntax packages (Syntax Art)

## MACULA Greek Nestle1904

- **Source:** [Clear-Bible/macula-greek](https://github.com/Clear-Bible/macula-greek) `Nestle1904/nodes/*.xml`
- **License:** CC BY 4.0 (attribute Clear Bible / Biblica)
- **Package id folder:** `macula-greek-nestle1904/`
- **Contents:** one JSON file per book (`MAT.json` …) + `manifest.json`

```bash
# After sparse-cloning MACULA nodes:
npm run import:macula-syntax -- --input /path/to/macula-greek/Nestle1904/nodes
# Optional subset:
npm run import:macula-syntax -- --input …/nodes --books MAT,JHN
```

UI: Living Margin → word card → **Syntax art**.
