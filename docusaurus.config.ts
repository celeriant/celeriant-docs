import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// docs.celeriant.io: docs-only, no blog, no versioning yet (pre-1.0).
// Local search, manual sidebar. Modelled on TigerBeetle's IA.
const config: Config = {
  title: "Celeriant",
  tagline: "An append-only event store for the write side of CQRS",
  favicon: "img/favicon.svg",

  url: "https://docs.celeriant.io",
  baseUrl: "/",

  organizationName: "celeriant",
  projectName: "celeriant-docs",

  onBrokenLinks: "throw",
  // NOTE: do not enable `future: { v4: true }`. It switches .md to CommonMark,
  // which renders `:::` admonitions as literal text.
  markdown: { hooks: { onBrokenMarkdownLinks: "warn" } },

  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/", // docs are the site root
          sidebarPath: "./sidebars.ts",
          // No editUrl: the repo is private pre-launch.
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: "/",
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig: {
    // TODO(stage5): add a social card at static/img/og.png and set `image` here.
    colorMode: { defaultMode: "light", respectPrefersColorScheme: true },
    navbar: {
      title: "Celeriant",
      logo: { alt: "Celeriant", src: "img/logo.svg" },
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        { to: "/get-started/quickstart", label: "Quickstart", position: "left" },
        { href: "https://celeriant.io", label: "celeriant.io", position: "right" },
        { href: "https://github.com/celeriant", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Get started", to: "/get-started/quickstart" },
            { label: "Concepts", to: "/concepts/event-sourcing" },
            { label: "Reference", to: "/reference/wire-protocol" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "celeriant.io", href: "https://celeriant.io" },
            { label: "GitHub", href: "https://github.com/celeriant" },
          ],
        },
      ],
      copyright: `Celeriant. Apache-2.0 release coming. © ${new Date().getFullYear()}.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["csharp", "rust", "toml", "bash", "json", "protobuf"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
