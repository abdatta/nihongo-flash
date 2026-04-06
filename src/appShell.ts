import { useEffect, useState } from 'react';

export type PageId = 'recognize' | 'recall' | 'stats' | 'settings';

const normalizePageFromHash = (hash: string): PageId => {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : '';
  const route = normalizedHash.replace(/^#/, '') || '/';
  const pathname = route.startsWith('/') ? route : `/${route}`;

  switch (pathname) {
    case '/':
    case '/read':
    case '/recognize':
      return 'recognize';
    case '/write':
    case '/recall':
      return 'recall';
    case '/stats':
      return 'stats';
    case '/settings':
      return 'settings';
    default:
      return 'recognize';
  }
};

const getCanonicalHash = (hash: string): string | null => {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : '';
  const route = normalizedHash.replace(/^#/, '') || '/';
  const pathname = route.startsWith('/') ? route : `/${route}`;

  switch (pathname) {
    case '/recognize':
      return '#/';
    case '/recall':
      return '#/write';
    default:
      return null;
  }
};

export const useActivePage = (): PageId => {
  const [activePage, setActivePage] = useState<PageId>(() => {
    if (typeof window === 'undefined') return 'recognize';
    return normalizePageFromHash(window.location.hash);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncPage = () => {
      const canonicalHash = getCanonicalHash(window.location.hash);
      if (canonicalHash && window.location.hash !== canonicalHash) {
        window.location.replace(`${window.location.pathname}${window.location.search}${canonicalHash}`);
        return;
      }

      setActivePage(normalizePageFromHash(window.location.hash));
    };

    syncPage();
    window.addEventListener('hashchange', syncPage);

    return () => {
      window.removeEventListener('hashchange', syncPage);
    };
  }, []);

  return activePage;
};

export const useViewportHeightVar = () => {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    let frameId: number | null = null;

    const syncViewportHeight = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
        frameId = null;
      });
    };

    syncViewportHeight();

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    window.addEventListener('pageshow', syncViewportHeight);
    visualViewport?.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('scroll', syncViewportHeight);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', syncViewportHeight);
      window.removeEventListener('pageshow', syncViewportHeight);
      visualViewport?.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);
};
