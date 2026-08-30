import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hive",
    short_name: "Hive",
    description: "Building-scale mesh inference. Join a group, unlock models, pay per token.",
    start_url: "/hive/HIVE",
    display: "standalone",
    background_color: "#090b08",
    theme_color: "#090b08",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
