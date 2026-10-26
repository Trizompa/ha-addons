import { svg, type SVGTemplateResult } from 'lit';
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiBrightnessAuto,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronLeft,
  mdiViewGridOutline,
  mdiChevronRight,
  mdiClose,
  mdiCheckboxMarked,
  mdiCodeBraces,
  mdiSourceBranch,
  mdiCodeJson,
  mdiCollapseAllOutline,
  mdiContentCopy,
  mdiContentSave,
  mdiContentSaveAll,
  mdiDeleteOutline,
  mdiCheckDecagramOutline,
  mdiDockLeft,
  mdiDownloadOutline,
  mdiFolderZipOutline,
  mdiHarddisk,
  mdiHistory,
  mdiContentDuplicate,
  mdiBackupRestore,
  mdiUploadOutline,
  mdiHomeAssistant,
  mdiPlusBoxMultipleOutline,
  mdiReload,
  mdiRestart,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFileCodeOutline,
  mdiFileDocumentOutline,
  mdiFileImageOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiFilePlusOutline,
  mdiFolder,
  mdiFormatListBulleted,
  mdiLightbulbOnOutline,
  mdiFolderOpen,
  mdiFolderPlusOutline,
  mdiInformationOutline,
  mdiLanguageCss3,
  mdiLanguageJavascript,
  mdiLanguageMarkdownOutline,
  mdiLanguagePython,
  mdiLinkVariant,
  mdiLock,
  mdiMagnify,
  mdiPencilOutline,
  mdiRedo,
  mdiRefresh,
  mdiUndo,
  mdiWeatherNight,
  mdiWeatherSunny,
  mdiWrap,
  mdiCompare,
  mdiFindReplace,
  mdiTextSearch,
  mdiFolderMoveOutline,
  mdiViewSplitVertical,
  mdiInformationVariantCircleOutline,
  mdiKeyboardClose,
} from '@mdi/js';
import { extension } from '../state/paths.js';

export const icons = {
  alert: mdiAlertCircleOutline,
  warning: mdiAlertOutline,
  info: mdiInformationOutline,
  ok: mdiCheckCircleOutline,
  themeAuto: mdiBrightnessAuto,
  themeLight: mdiWeatherSunny,
  themeDark: mdiWeatherNight,
  chevronRight: mdiChevronRight,
  chevronDown: mdiChevronDown,
  chevronLeft: mdiChevronLeft,
  gallery: mdiViewGridOutline,
  close: mdiClose,
  collapse: mdiCollapseAllOutline,
  copy: mdiContentCopy,
  save: mdiContentSave,
  saveAll: mdiContentSaveAll,
  delete: mdiDeleteOutline,
  sidebar: mdiDockLeft,
  download: mdiDownloadOutline,
  zip: mdiFolderZipOutline,
  history: mdiHistory,
  storage: mdiHarddisk,
  duplicate: mdiContentDuplicate,
  restore: mdiBackupRestore,
  upload: mdiUploadOutline,
  insert: mdiPlusBoxMultipleOutline,
  homeAssistant: mdiHomeAssistant,
  check: mdiCheckDecagramOutline,
  reload: mdiReload,
  restart: mdiRestart,
  show: mdiEyeOutline,
  hide: mdiEyeOffOutline,
  fileNew: mdiFilePlusOutline,
  folderNew: mdiFolderPlusOutline,
  folder: mdiFolder,
  folderOpen: mdiFolderOpen,
  file: mdiFileOutline,
  link: mdiLinkVariant,
  lock: mdiLock,
  search: mdiMagnify,
  rename: mdiPencilOutline,
  redo: mdiRedo,
  refresh: mdiRefresh,
  undo: mdiUndo,
  wrap: mdiWrap,
  compare: mdiCompare,
  replace: mdiFindReplace,
  searchAll: mdiTextSearch,
  move: mdiFolderMoveOutline,
  split: mdiViewSplitVertical,
  about: mdiInformationVariantCircleOutline,
  keyboardClose: mdiKeyboardClose,
  outline: mdiFormatListBulleted,
  haHints: mdiLightbulbOnOutline,
  template: mdiCodeBraces,
  git: mdiSourceBranch,
  checkbox: mdiCheckboxMarked,
};

export function icon(path: string, size = 18): SVGTemplateResult {
  return svg`<svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true" focusable="false"><path fill="currentColor" d=${path}></path></svg>`;
}

/** Icona e colore per tipo di file nell'albero e nelle tab. */
export function fileIcon(path: string): { path: string; color: string } {
  switch (extension(path)) {
    case 'yaml':
    case 'yml':
      return { path: mdiFileCodeOutline, color: '#e0464e' };
    case 'json':
      return { path: mdiCodeJson, color: '#d9a400' };
    case 'py':
      return { path: mdiLanguagePython, color: '#3b78b5' };
    case 'js':
    case 'mjs':
    case 'ts':
      return { path: mdiLanguageJavascript, color: '#d6b600' };
    case 'css':
      return { path: mdiLanguageCss3, color: '#2f7bd6' };
    case 'md':
      return { path: mdiLanguageMarkdownOutline, color: '#6f7a87' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'avif':
    case 'bmp':
    case 'ico':
    case 'svg':
      return { path: mdiFileImageOutline, color: '#8e5cd9' };
    case 'pdf':
      return { path: mdiFilePdfBox, color: '#d9473a' };
    case 'txt':
    case 'log':
      return { path: mdiFileDocumentOutline, color: '#6f7a87' };
    default:
      return { path: mdiFileOutline, color: '#8794a3' };
  }
}
