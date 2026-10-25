import { it } from 'vitest'
import { trackLeadRun, trackPaths } from './aimTrack'

/* Screen-locked aim tracking a moving lead (report only); see aimTrack.ts. */
it('reports screen-locked aim tracking of a moving lead (report only)', () => {
  console.table(Object.keys(trackPaths).map(name => trackLeadRun(name)))
}, 60000)
