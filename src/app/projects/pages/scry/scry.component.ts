import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { BannerComponent } from '@components/banner/banner.component';
import { CodeBlockComponent } from '@components/code-block/code-block.component';
import { MermaidDiagramComponent } from '@components/mermaid-diagram/mermaid-diagram.component';
import { ImageTileComponent } from '@components/image-tile/image-tile.component';
import { ImageViewerModalComponent } from '@components/image-viewer-modal/image-viewer-modal.component';
import { GalleryImageData } from '@lib/gallery';

/**
 * Scry is a separate project (its own repo), so this page is a write-up
 * rather than a live demo — the interesting parts (RTSP ingest, ONVIF PTZ,
 * WebRTC over the LAN) can't run inside a static SPA. The page tells the
 * story and the architecture; the repo README stays the operations manual.
 */
@Component({
  selector: 'x-scry',
  templateUrl: './scry.component.html',
  styleUrls: ['./scry.component.scss'],
  imports: [
    BannerComponent,
    CodeBlockComponent,
    MermaidDiagramComponent,
    ImageTileComponent,
    ImageViewerModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScryComponent {
  readonly repoUrl = 'https://github.com/slamdewey/scry';

  private readonly imageViewer = viewChild.required(ImageViewerModalComponent);

  /**
   * Optional hero screenshot. To show it, drop an image at
   * `src/assets/scry_viewer.png` and keep this `true`; set it `false` (or
   * delete the guarded <section> in the template) to remove it. Shown as a
   * thumbnail that opens the shared image viewer modal.
   */
  readonly showScreenshot = true;
  readonly screenshot: GalleryImageData = {
    title: 'Scry live view',
    caption: 'The Scry live-view interface.',
    img_src: 'assets/scry_viewer.png',
    placeholder_src: 'assets/scry_viewer.png',
    lastModified: '',
  };

  openViewer(): void {
    this.imageViewer().openModal();
  }

  readonly architectureDiagram = `flowchart LR
  Browser["Browser<br/>on the LAN"]
  subgraph Pi["Raspberry Pi"]
    direction TB
    Caddy["Caddy<br/>:80 · reverse proxy"]
    Server["scry-server<br/>:8080 · Node/Express + Angular"]
    Go2rtc["go2rtc<br/>:1984 · RTSP → WebRTC"]
    Dnsmasq["dnsmasq<br/>:53 · resolves 'scry'"]
  end
  Cameras["IP Cameras<br/>RTSP · ONVIF"]

  Browser -->|HTTP :80| Caddy
  Caddy --> Server
  Server -->|/stream/*| Go2rtc
  Go2rtc -->|RTSP| Cameras
  Go2rtc -.->|WebRTC · UDP :8555| Browser`;

  readonly flowDiagram = `sequenceDiagram
  autonumber
  actor U as Browser
  participant C as Caddy :80
  participant S as scry-server :8080
  participant G as go2rtc :1984
  participant Cam as IP Camera

  U->>C: GET / (page shell + Angular bundle)
  C->>S: reverse-proxy
  S-->>U: index.html + JS
  Note over U: Angular app bootstraps
  U->>C: GET /api/cameras
  C->>S: proxy
  S-->>U: camera list (from cameras.yaml)
  U->>C: GET /stream/camera_one
  C->>S: proxy
  S->>G: proxy to :1984
  G->>Cam: open RTSP session
  Cam-->>G: H.264 stream
  G-->>U: WebRTC signaling (SDP offer/answer)
  Note over U,G: media then flows direct over UDP :8555`;

  readonly camerasYaml = `cameras:
  - id: camera_one          # used in URLs, must be unique, snake_case
    label: Front door       # shown in the UI
    model: tapo-c200        # key into models.yaml
    network:
      ip: <camera-ip>
      user: <rtsp-username>
      pass: <rtsp-password>`;
}
