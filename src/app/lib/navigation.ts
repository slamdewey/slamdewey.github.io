export interface NavigationLink {
  /**
   * also used to find the relevant css class
   */
  key: string;
  label: string;
  ariaLabel?: string;
  svgGroupTransform?: string;
  svgPathData: string;
  svgPathViewBox?: string;
  isActive?: boolean;
}

export interface InternalLink extends NavigationLink {
  routerLink: string;
}

export interface ExternalLink extends NavigationLink {
  routerLink?: undefined;
  href: string;
  target: '_blank';
  isActive?: false;
}