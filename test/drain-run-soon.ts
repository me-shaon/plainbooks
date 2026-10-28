import { afterEach, beforeEach } from "vitest";
import { trackRunSoonForTesting } from "../src/worker/services/jobs";

// A job that runJobSoon starts can outlive its test and write into the next test's rows.
// Every worker test awaits those runs before the next test resets the database. A file
// that removes fakes in its own afterEach should also await the runs there first, because
// the file hooks run before these.
let runs: Promise<void>[] = [];

beforeEach(() => {
  runs = [];
  trackRunSoonForTesting(runs);
});

afterEach(async () => {
  await Promise.all(runs);
  trackRunSoonForTesting(null);
});
