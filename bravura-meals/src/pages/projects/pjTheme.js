import { THEME as BASE, MODULE_COLORS as BASE_COLORS } from '../../utils/permissions'
import { FIN } from '../../utils/financeTheme'

// Projects (#76) wear the finance look: the older project screens import THEME from here, so their insides
// pick up the FIN palette (maroon actions, blue links, quiet green-grey ground) without rewriting each style.
export const THEME = {
  ...BASE,
  primary: FIN.maroon, primaryDark: FIN.maroonDark, primaryLight: FIN.maroonTint, primaryHover: FIN.maroonDark, onPrimary: '#fff',
  accent: FIN.blue, accentDark: FIN.blue, accentLight: FIN.blueTint,
  surface: FIN.card, surfaceVar: FIN.ground, surfaceHover: FIN.lineSoft,
  outline: FIN.field, outlineVar: FIN.line, bg: FIN.ground,
  text: FIN.ink, textMed: FIN.muted, textLow: FIN.faint,
  error: FIN.bad, success: FIN.good, warning: FIN.ochre, info: FIN.blue,
  statusSuccessBg: FIN.goodTint, statusSuccessText: FIN.good,
  statusWarningBg: FIN.ochreTint, statusWarningText: FIN.ochreText,
  statusErrorBg: '#FBEDEC', statusErrorText: FIN.bad,
  statusNeutralBg: FIN.lineSoft, statusNeutralText: FIN.muted,
  statusInfoBg: FIN.blueTint, statusInfoText: FIN.blue,
  statusTertiaryBg: '#F4EFFA', statusTertiaryText: '#7A4FB5',
  shadow1: 'none', shadow2: '0 1px 3px rgba(22,33,29,.08)', shadow3: '0 8px 24px rgba(22,33,29,.12)',
}
export const MODULE_COLORS = { ...BASE_COLORS, projects: FIN.maroon }
