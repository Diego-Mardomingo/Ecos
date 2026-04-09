declare module "pulltorefreshjs" {
  export type PullToRefreshDone = () => void;

  export interface PullToRefreshHandler {
    destroy: () => void;
    mainElement: HTMLElement;
    triggerElement: HTMLElement;
    shouldPullToRefresh: () => boolean;
  }

  export interface PullToRefreshOptions {
    distThreshold?: number;
    distMax?: number;
    distReload?: number;
    distIgnore?: number;
    mainElement?: HTMLElement | string;
    triggerElement?: HTMLElement | string;
    ptrElement?: string;
    classPrefix?: string;
    cssProp?: string;
    iconArrow?: string;
    iconRefreshing?: string;
    instructionsPullToRefresh?: string;
    instructionsReleaseToRefresh?: string;
    instructionsRefreshing?: string;
    refreshTimeout?: number;
    getMarkup?: () => string;
    getStyles?: () => string;
    onInit?: (handler: PullToRefreshHandler) => void;
    onRefresh?: (done: PullToRefreshDone) => unknown;
    resistanceFunction?: (t: number) => number;
    shouldPullToRefresh?: () => boolean;
  }

  interface PullToRefreshAPI {
    init(options?: PullToRefreshOptions): PullToRefreshHandler;
    destroyAll(): void;
    setPassiveMode(isPassive: boolean): void;
    setPointerEventsMode(isEnabled: boolean): void;
  }

  const PullToRefresh: PullToRefreshAPI;
  export default PullToRefresh;
}
