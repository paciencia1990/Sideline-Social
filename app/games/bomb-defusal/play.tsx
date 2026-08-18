import BombDefusalScreen from "@/game/BombDefusalScreen";
import SynchronizedGameStartGate from "@/components/SynchronizedGameStartGate";

export default function BombDefusalPlayRoute() {
  return (
    <SynchronizedGameStartGate gameType="bombDefusal">
      <BombDefusalScreen />
    </SynchronizedGameStartGate>
  );
}
