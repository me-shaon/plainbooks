import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy } from "react";

// The design gallery exists only in development. In a production build `import.meta.env.DEV`
// is false, so the gallery code is removed and the route answers "not found".
const DesignGallery = import.meta.env.DEV ? lazy(() => import("../dev/design-gallery")) : null;

export const Route = createFileRoute("/_design")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: () => (DesignGallery ? <DesignGallery /> : null),
});
