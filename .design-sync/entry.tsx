// design-sync bundle entry — exports exactly the design-surface components to
// window.ScriptureApp. Explicit (not synth-from-src) so main.tsx's createRoot
// side-effect never enters the bundle. See .design-sync/NOTES.md.
export { App } from "../src/renderer/app.js";
export { ScripturePage } from "../src/renderer/components/ScripturePage.js";
export { LivingMargin } from "../src/renderer/components/LivingMargin.js";
export { SearchView } from "../src/renderer/components/SearchView.js";
export { SettingsPage } from "../src/renderer/components/SettingsPage.js";
export { WritingSheet } from "../src/renderer/components/WritingSheet.js";
export { ImportPage } from "../src/renderer/components/ImportPage.js";
export { BudgetSettings } from "../src/renderer/components/BudgetSettings.js";
// Non-surface but needed by previews (ScripturePage/App use useToast):
export { ToastProvider } from "../src/renderer/components/Toast.js";
