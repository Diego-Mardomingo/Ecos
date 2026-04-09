/** Markup y estilos para pulltorefreshjs alineados al tema ECOS (variables CSS en runtime). */

export const ECOS_PTR_CLASS_PREFIX = "ecos-ptr--";

/** Misma estructura que el default de pulltorefreshjs; __PREFIX__ lo sustituye la librería. */
export function getEcosPullToRefreshMarkup(): string {
  return `
<div class="__PREFIX__box">
  <div class="__PREFIX__content">
    <div class="__PREFIX__icon"></div>
    <div class="__PREFIX__text"></div>
  </div>
</div>
`;
}

const ICON_ARROW = `<svg class="ecos-ptr-arrow" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M21 21v-5h-5"/></svg>`;

const ICON_LOADING = `<svg class="ecos-ptr-spinner" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

export const ECOS_PTR_ICONS = {
  iconArrow: ICON_ARROW,
  iconRefreshing: ICON_LOADING,
} as const;

export function getEcosPullToRefreshStyles(): string {
  return `
.__PREFIX__ptr {
  pointer-events: none;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  top: 0;
  height: 0;
  transition: height 0.35s cubic-bezier(0.33, 1, 0.68, 1), min-height 0.35s cubic-bezier(0.33, 1, 0.68, 1);
  text-align: center;
  width: 100%;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  align-content: stretch;
  background: var(--background);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.dark .__PREFIX__ptr {
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.__PREFIX__pull {
  transition: none;
}

.__PREFIX__box {
  padding: 12px 16px 14px;
  flex-basis: 100%;
}

.__PREFIX__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.__PREFIX__text {
  color: var(--muted-foreground);
  line-height: 1.3;
}

.__PREFIX__icon {
  color: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.__PREFIX__icon svg {
  display: block;
}

.__PREFIX__release .__PREFIX__icon {
  transform: rotate(180deg);
}

.__PREFIX__refresh .__PREFIX__icon .ecos-ptr-spinner {
  animation: ecos-ptr-spin 0.75s linear infinite;
  transform-origin: center;
}

.__PREFIX__top {
  touch-action: pan-x pan-down pinch-zoom;
}

@keyframes ecos-ptr-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .__PREFIX__ptr {
    transition: height 0.2s ease, min-height 0.2s ease;
  }
  .__PREFIX__icon {
    transition: none;
  }
  .__PREFIX__release .__PREFIX__icon {
    transform: none;
  }
  .__PREFIX__refresh .__PREFIX__icon .ecos-ptr-spinner {
    animation: none;
    opacity: 0.85;
  }
}
`;
}
