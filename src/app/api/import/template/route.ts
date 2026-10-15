import { api } from "@/server/http";
import { csvTemplate } from "@/lib/import/parse";

export const GET = api(async () => {
  return new Response("﻿" + csvTemplate() + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kairos-tester-import-template.csv"',
    },
  });
});
