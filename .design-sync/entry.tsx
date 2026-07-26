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
// BudgetSettings was removed from the app in 3f8ec71 ("Refine settings
// onboarding and import"). Its export, its componentSrcMap pin, its
// dtsPropsFor entry and its preview are all gone with it.
// The two surfaces this project exists to redesign, plus their parts.
// LanguageWordsSection IS the word card; RenderingOrbitView is the sense/
// rendering orbit inside it. NOTE the export is `RenderingOrbitView`, not
// `RenderingOrbit` — the file also exports SenseOutlineView and several model
// builders (forwardOrbitModel, reverseOrbitModel, senseOutlineModel), which
// ship on the global and are usable from previews.
export { LanguageWordsSection } from "../src/renderer/components/LanguageWordsSection.js";
export { RenderingOrbitView, SenseOutlineView } from "../src/renderer/components/RenderingOrbit.js";
// The model builders MUST be exported too, not merely mentioned. Previews import
// from 'scripture-app', which is shimmed to window.ScriptureApp — so a name that
// is not on the global resolves to `undefined` SILENTLY: no compile error, a
// runtime death inside the story. Building a model by hand instead of calling
// these is how a preview drifts from what the app actually renders.
export {
  forwardOrbitModel,
  reverseOrbitModel,
  senseOutlineModel,
  semanticSenseOutlineModel,
} from "../src/renderer/components/RenderingOrbit.js";
export { SourcesDisclosure } from "../src/renderer/components/SourcesDisclosure.js";
export { ConnectionCard } from "../src/renderer/components/ConnectionCard.js";

// Non-surface but needed by previews (ScripturePage/App use useToast, and so
// does SourcesDisclosure — every preview that renders it must wrap in this):
export { ToastProvider } from "../src/renderer/components/Toast.js";
