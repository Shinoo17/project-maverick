/*
Placeholder for the theatre map image: a grid, a few contour lines, the
coastline and the front line. Swap it for a real map image when one exists.
*/
import { useTranslation } from 'react-i18next'

export function TheatreBackdrop() {
  const { t } = useTranslation()
  return <div className="campaign-theatre menu-backdrop" aria-hidden="true">
    <svg viewBox="0 0 1440 810" preserveAspectRatio="none">
      <path className="campaign-contour" d="M-20 260 C 180 200, 300 330, 520 250 S 860 120, 1100 190" />
      <path className="campaign-contour" d="M-20 300 C 200 240, 310 380, 540 290 S 880 170, 1120 240" />
      <path className="campaign-contour" d="M180 810 C 260 700, 420 720, 470 620 S 700 560, 760 690 S 900 790, 1000 810" />
      <path className="campaign-coast" d="M0 700 C 120 690, 160 760, 280 740 S 420 790, 460 810" />
      <path className="campaign-front" d="M500 0 C 470 160, 560 250, 500 390 S 520 640, 470 810" />
    </svg>
    <span className="campaign-area is-front">{t('campaignFrontLine')}</span>
    <span className="campaign-area is-friendly">{t('campaignFriendly')}</span>
    <span className="campaign-area is-hostile">{t('campaignHostile')}</span>
    <span className="menu-placeholder campaign-image-note">{t('campaignMapPending')}</span>
  </div>
}
