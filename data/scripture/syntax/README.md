# Syntax packages (Structure charts)

## MACULA Greek Nestle1904

- **Folder:** `macula-greek-nestle1904/`
- **Source:** Clear-Bible/macula-greek `Nestle1904/nodes/*.xml`
- **License:** CC BY 4.0

```bash
npm run import:macula-syntax -- --input /path/to/macula-greek/Nestle1904/nodes
```

## MACULA Hebrew WLC

- **Folder:** `macula-hebrew-wlc/`
- **Source:** Clear-Bible/macula-hebrew `WLC/nodes/*.xml` (per chapter)
- **License:** CC BY 4.0
- **Focus match:** OSHB token packages use different ids; app matches focus by Strong’s + verse.

```bash
npm run import:macula-hebrew-syntax -- --input /path/to/macula-hebrew/WLC/nodes
# subset:
npm run import:macula-hebrew-syntax -- --input …/nodes --books GEN,PSA,ISA
```

UI: Living Margin → **Structure · open** (Greek + Hebrew when data present).
