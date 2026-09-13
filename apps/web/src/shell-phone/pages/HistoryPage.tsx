import { Card, Group, GroupRow } from "../../shared/ui.tsx";

export function HistoryPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">History</h1>
      </div>
      <Card>
        <p className="kbd-hint">Starts cold; every session lands here and replays into the engine.</p>
      </Card>
      <Group label="This week">
        <GroupRow>
          <span>Sun · Lower A · 20.4k lb · 58 min</span>
          <span className="kbd-hint">1 PR</span>
        </GroupRow>
        <GroupRow>
          <span>Sat · Long run · 7.0 mi · 1:04</span>
          <span className="kbd-hint">rTSS 84</span>
        </GroupRow>
        <GroupRow>
          <span>Fri · Upper B · 14.1k lb · 52 min</span>
        </GroupRow>
        <GroupRow>
          <span>Thu · Lower B · 18.9k lb · 61 min</span>
        </GroupRow>
      </Group>
    </div>
  );
}
