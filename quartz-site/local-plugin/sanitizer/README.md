# Wiki Rendering Policy

This Quartz transformer is the primary rendering boundary for wiki content. It removes raw HTML nodes, scriptable elements, event-handler attributes, executable URLs, and inline styles before pages are emitted.

URL-bearing properties are denylisted for executable schemes, including `data:`. That deliberately blocks inline data images as well as executable payloads: the wiki does not currently need data URLs, and allowing one would expand the rendering attack surface. Use repository-hosted image assets instead.

The plugin is configured with `order: 999` and is intended to run last in the HTML pipeline. `defaultOrder` matches that configuration for consumers that do not provide an explicit order.
