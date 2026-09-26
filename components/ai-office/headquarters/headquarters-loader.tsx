"use client";
import dynamic from "next/dynamic";
const Headquarters = dynamic(() => import("./headquarters-world"), {
  ssr: false,
  loading: () => (
    <p role="status">
      Preparing the live headquarters… <a href="/office/classic">Classic Office</a>
    </p>
  ),
});
export function HeadquartersLoader() {
  return <Headquarters />;
}
