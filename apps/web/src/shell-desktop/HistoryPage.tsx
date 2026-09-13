import { Card, DataTable } from "../shared/ui.tsx";

export function DesktopHistoryPage() {
  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>History</h2>
      </div>
      <Card>
        <DataTable
          head={["Date", "Session", "Load", "sRPE", "Notes"]}
          rows={[
            ["Sep 13", "Lower A · 20.4k lb", "510", "8", "squat PR"],
            ["Sep 12", "Long run · 7.0 mi", "290", "7", "rTSS 84"],
            ["Sep 11", "Upper B · 14.1k lb", "380", "7", ""],
            ["Sep 9", "Lower B · 18.9k lb", "470", "8", ""],
          ]}
        />
      </Card>
    </div>
  );
}
