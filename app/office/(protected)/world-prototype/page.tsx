import { WorldLoader } from "@/components/ai-office/world-prototype/world-loader";
export const metadata = {
  title: "3D World Prototype",
  robots: { index: false, follow: false },
};
/** Protected by the existing Office layout. No project data or actions are passed. */
export default function WorldPrototypePage() {
  return <WorldLoader />;
}
