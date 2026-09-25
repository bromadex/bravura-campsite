import { createContext, useContext } from 'react'

// True when a page is rendered inside a Finance hub (FinShell with tabs). Pages and the shared
// PageHeader use it to drop their own title — the hub already shows one — and keep only actions.
export const FinEmbedContext = createContext(false)
export const useFinEmbedded = () => useContext(FinEmbedContext)
