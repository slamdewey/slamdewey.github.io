import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';

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

const INTERNAL_LINKS: InternalLink[] = [
  {
    key: 'home',
    routerLink: '/',
    label: 'A Place I once called "Home"',
    ariaLabel: 'Home',
    svgGroupTransform: 'translate(147, 160) scale(2.5)',
    svgPathData: `M61.44,0L0,60.18l14.99,7.87L61.04,19.7l46.85,48.36l14.99-7.87L61.44,0L61.44,0z M18.26,69.63L18.26,69.63 L61.5,26.38l43.11,43.25h0v0v42.43H73.12V82.09H49.49v29.97H18.26V69.63L18.26,69.63L18.26,69.63z`,
    svgPathViewBox: '0 0 122 112',
  },
  {
    key: 'projects',
    routerLink: '/projects',
    label: `Things I've called "Projects"`,
    ariaLabel: 'Projects',
    svgGroupTransform: 'translate(138, 138) scale(9)',
    svgPathData: `M34.87,32.21,30,27.37V8.75L27.7,4.52a2,2,0,0,0-3.54,0L22,8.76V19.41L3.71,1.21A1,1,0,0,0,2,1.92V10H4.17v1.6H2V18H4.17v1.6H2v6.65H4.17v1.6H2v5.07a1,1,0,0,0,1,1H34.16a1,1,0,0,0,.71-1.71ZM10,26V16.94L19.07,26Zm18,2.11H24V25.68h4Zm0-4H24V9.25l1.94-3.77L28,9.26Z`,
    svgPathViewBox: '0 0 36 36',
  },
  {
    key: 'gallery',
    routerLink: '/gallery',
    label: `Pictures I've called "Taken"`,
    ariaLabel: 'Gallery',
    svgGroupTransform: 'translate(150, 150) scale(.9)',
    svgPathData: `M319.578,87.434h-88.087l-8.589-37.933c-0.825-3.646-4.066-6.233-7.803-6.233h-90c-3.737,0-6.978,2.588-7.803,6.233 l-8.589,37.933h-20.94V77.351c0-4.419-3.582-8-8-8H35.383c-4.418,0-8,3.581-8,8v10.083h-6.762C9.251,87.434,0,96.685,0,108.057 v159.421c0,11.371,9.251,20.623,20.621,20.623h110.17c11.926,5.66,25.253,8.833,39.309,8.833c14.056,0,27.383-3.173,39.309-8.833 h110.17c11.371,0,20.623-9.251,20.623-20.623V108.057C340.201,96.685,330.949,87.434,319.578,87.434z M170.1,280.934 c-41.906,0-76-34.093-76-76s34.094-76,76-76c41.906,0,76,34.093,76,76S212.006,280.934,170.1,280.934z M304.738,142.934 c0,3.682-2.985,6.667-6.667,6.667h-36.943c-3.682,0-6.667-2.984-6.667-6.667v-16.667c0-3.682,2.985-6.666,6.667-6.666h36.943 c3.682,0,6.667,2.984,6.667,6.666V142.934z`,
    svgPathViewBox: '0 0 330 330',
  },
];
const EXTERNAL_LINKS: ExternalLink[] = [
  {
    key: 'sourcecode',
    href: 'https://github.com/slamdewey/slamdewey.github.io',
    target: '_blank',
    label: 'Source code for this site',
    svgGroupTransform: 'translate(135, 135) scale(17)',
    svgPathData: `M5.719 14.75a.997.997 0 0 1-.664-.252L-.005 10l5.341-4.748a1 1 0 0 1 1.328 1.495L3.005 10l3.378 3.002a1 1 0 0 1-.664 1.748zm8.945-.002L20.005 10l-5.06-4.498a.999.999 0 1 0-1.328 1.495L16.995 10l-3.659 3.252a1 1 0 0 0 1.328 1.496zm-4.678 1.417l2-12a1 1 0 1 0-1.972-.329l-2 12a1 1 0 1 0 1.972.329z`,
    svgPathViewBox: '0 0 20 20',
  },
  {
    key: 'github',
    href: 'https://github.com/slamdewey',
    target: '_blank',
    label: 'Github',
    svgPathData: `M300 150c-82.8348 0-150 68.8393-150 153.817 0 67.9687 42.991 125.558 102.5893 145.9151 7.5 1.4063 10.2455-3.3482 10.2455-7.433 0-3.683-.134-13.3259-.2009-26.183-41.7187 9.308-50.558-20.625-50.558-20.625-6.8304-17.7456-16.6741-22.5-16.6741-22.5-13.5938-9.576 1.0044-9.375 1.0044-9.375 15.067 1.0714 22.9688 15.8705 22.9688 15.8705 13.3929 23.5045 35.0893 16.741 43.6607 12.7902 1.3393-9.9107 5.2232-16.741 9.509-20.558-33.2813-3.884-68.3036-17.076-68.3036-76.0045 0-16.808 5.8259-30.5357 15.4018-41.25-1.5402-3.884-6.6965-19.5536 1.4732-40.7143 0 0 12.5893-4.1518 41.25 15.7366 11.9866-3.4152 24.7768-5.0893 37.567-5.1562 12.7231.067 25.5803 1.741 37.5669 5.1562 28.6607-19.8884 41.183-15.7366 41.183-15.7366 8.1697 21.1607 3.0134 36.8304 1.4733 40.7143 9.5758 10.7812 15.4017 24.509 15.4017 41.25 0 59.0625-35.0892 72.0536-68.5044 75.8705 5.3571 4.7545 10.1785 14.1295 10.1785 28.4598 0 20.558-.2009 37.1652-.2009 42.1875 0 4.0849 2.6786 8.9063 10.3125 7.3661C407.076 429.308 450 371.7187 450 303.817 450 218.8393 382.8348 150 300 150z`,
  },
  {
    key: 'linkedin',
    href: 'https://linkedin.com/in/jared-massa',
    target: '_blank',
    label: 'LinkedIn',
    svgPathData: `M278.9308 253.1923h43.5769v20.0539h.5923c6.0923-11.5077 20.9-23.6077 43.0692-23.6077 46.0308 0 54.577 30.2923 54.577 69.723v80.2154h-45.4385v-71.1615c0-17.0077-.2539-38.8385-23.6077-38.8385-23.6923 0-27.2462 18.5308-27.2462 37.5693v72.4307h-45.4384l-.0846-146.3846zm-74.1231 0h45.523V399.577h-45.523V253.1923zm22.8461-72.7692c14.5539 0 26.4 11.8461 26.4 26.4 0 14.5538-11.8461 26.4-26.4 26.4-14.6384 0-26.4-11.8462-26.4-26.4 0-14.5539 11.7616-26.4 26.4-26.4z`,
  },
];

@Component({
  selector: 'x-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.scss'],
  imports: [RouterLink],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationComponent implements OnInit {
  public internalLinks = signal(INTERNAL_LINKS.slice());
  public externalLinks = signal(EXTERNAL_LINKS.slice());
  public activeLink: NavigationLink | undefined;

  private readonly router = inject(Router);

  ngOnInit(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => this.onRouteChange(event as NavigationEnd));
  }

  public getStyles(link: NavigationLink) {
    return {
      navigation__links__item: true,
      [`navigation__links__item--${link.key}`]: true,
      active: link.isActive,
    };
  }

  private onRouteChange(event: NavigationEnd) {
    const SplitUrlByFolderAndQueryParams = /[//?,&+#]/;
    const newInternalLinks = INTERNAL_LINKS.slice();
    /**
     * We want both /projects and /projects/test to highlight the projets link
     */
    const majorUrlIdToActivate: string = event.url
      .slice(1)
      .split(SplitUrlByFolderAndQueryParams)[0];
    const linkToActivate = newInternalLinks.find((link) => {
      const navLinkMajorUrlId = link.routerLink.slice(1).split(SplitUrlByFolderAndQueryParams)[0];
      return majorUrlIdToActivate === navLinkMajorUrlId;
    });
    if (this.activeLink) {
      this.activeLink.isActive = false;
    }
    if (linkToActivate) {
      linkToActivate.isActive = true;
    }
    this.activeLink = linkToActivate;
    this.internalLinks.set(newInternalLinks);
  }
}