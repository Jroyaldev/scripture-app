# Build Your First Plugin In 10 Minutes

This guide builds a margin panel plugin that reads the active Scripture reference, writes a Derived claim, and renders one panel. It never writes Substrate.

## Manifest

```json
{
  "id": "example.sermon-surfacer",
  "name": "Sermon Surfacer",
  "version": "0.1.0",
  "apiVersion": "1",
  "entry": { "desktop": "main.js" },
  "capabilities": ["read:references", "write:derived", "ui:panel"],
  "hooks": ["onReferenceOpen"],
  "contributes": {
    "panels": [{ "id": "sermons", "title": "Sermons", "location": "margin" }]
  }
}
```

## Entry

```js
module.exports = async function plugin(api) {
  const ref = await api.references.read("bref:v1/ACT.19.1-ACT.19.7");
  await api.derived.write({
    kind: "claim",
    id: "claim_plugin_acts19",
    payload: {
      assertion: "Acts 19 connects baptism and receiving the Spirit.",
      ref: ref.display
    }
  });
  await api.ui.panel({
    id: "sermons",
    title: "Sermons",
    html: "<section><h2>Acts 19</h2><p>" + ref.text + "</p></section>"
  });
};
```

## Verify

Run:

```bash
npm run verify:m5
```

The broker is default-deny. Add `network:fetch` plus `network.allowedHosts` before fetching, and note that `write:substrate` does not exist.
