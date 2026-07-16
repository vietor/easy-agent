import { memo, useSyncExternalStore } from "react";
import { Box } from "ink";
import type { Session } from "@vietor/easy-agent-core";
import { LogView } from "./LogView.js";

export const LogList = memo(function LogList({ session }: { session: Session }) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const entries = view.logEntries;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {entries.map((entry, i) => (
        <LogView key={i} entry={entry} />
      ))}
    </Box>
  );
});
