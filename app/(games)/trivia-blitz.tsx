import TriviaBlitzScreen from "@/src/game/triviaBlitz/TriviaBlitzScreen";
import SynchronizedGameStartGate from "@/components/SynchronizedGameStartGate";

export default function TriviaBlitzPlayRoute() {
  return (
    <SynchronizedGameStartGate gameType="triviaBlitz">
      <TriviaBlitzScreen />
    </SynchronizedGameStartGate>
  );
}
