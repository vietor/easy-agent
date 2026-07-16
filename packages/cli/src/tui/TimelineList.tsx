import { memo, useSyncExternalStore } from "react";
import { Box } from "ink";
import type { Session } from "@vietor/easy-agent-core";
import { TimelineView } from "./TimelineView.js";

export const TimelineList = memo(function TimelineList({ session }: { session: Session }) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const entries = view.timeline;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {entries.map((entry, i) => (
        <TimelineView key={i} entry={entry} />
      ))}
    </Box>
  );
});
