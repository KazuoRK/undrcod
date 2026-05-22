export { DiffViewer, type DiffViewerHandle, type DiffViewerProps } from './DiffViewer';
export {
  hunksToBeforeAfter,
  parseHunkHeader,
  inferMonacoLanguage,
  computeDiffBetweenStrings,
  type DiffHunk,
  type DiffLine,
  type DiffLineType,
  type LineMapEntry,
  type HunksToBeforeAfterResult,
} from './diffParser';
export { hunkToPatch, type PatchHunkInput } from './patchGenerator';
