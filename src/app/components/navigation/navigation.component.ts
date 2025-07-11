import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { NavigationLink } from 'src/app/lib/navigation';
import { INTERNAL_LINKS, EXTERNAL_LINKS } from './links';

@Component({
    selector: 'x-navigation',
    templateUrl: './navigation.component.html',
    styleUrls: ['./navigation.component.scss'],
    imports: [RouterLink],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavigationComponent implements OnInit {
  
  public internalLinks = signal(INTERNAL_LINKS);
  public externalLinks = signal(EXTERNAL_LINKS);
  public activeLink = signal<NavigationLink | undefined>(undefined);

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
    const newInternalLinks = [...INTERNAL_LINKS];
    const activeLink = this.activeLink();

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

    if (activeLink) {
      activeLink.isActive = false;
    }
    if (linkToActivate) {
      linkToActivate.isActive = true;
    }

    this.activeLink.set(linkToActivate);
    this.internalLinks.set(newInternalLinks);
  }
}
