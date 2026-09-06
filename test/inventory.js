"use strict";
// Generates the adapter's complete object inventory from fixtures and proves that
// an update reaches every object of an existing installation.
//
// Suite 1 "object inventory": start the adapter in the throwaway js-controller,
//   drive it with fixtures covering EVERY device type the adapter supports
//   (feedFixtures), then dump every <adapter>.0.* object to
//   test/objects.inventory.json in the ioBroker object-structure bot's format.
// Suite 2 "upgrade from the previous release" (only when INVENTORY_PREVIOUS is
//   set — pre-release.py exports the last tag's inventory): seed the previous
//   objects BEFORE start, start, feed, then assert that every object carries the
//   current name/desc/role/type/unit and that removed objects are gone.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { tests } = require("@iobroker/testing");

const ADAPTER_DIR = path.join(__dirname, "..");
const ADAPTER = require(path.join(ADAPTER_DIR, "io-package.json")).common.name;
const NS = `${ADAPTER}.0.`;
const INVENTORY = path.join(__dirname, "objects.inventory.json");
const VOLATILE = ["ts", "from", "user", "acl"];
const COMPARED = ["name", "desc", "role", "type", "unit"];
/** 5 channels + 12 states — the adapter's whole catalog, independent of the configured country. */
const EXPECTED_OBJECTS = require(path.join(ADAPTER_DIR, "io-package.json")).instanceObjects.length;

/**
 * Adapter-specific: make the adapter create every object it can create.
 *
 * This adapter is catalog-driven — there is no device, no cloud and no message: the same 17
 * objects appear for every configuration, so there is nothing to feed. What IS needed is a wait,
 * because it runs in SCHEDULE mode: `startAdapterAndWait` resolves on `alive`, which happens long
 * before onReady has computed and written anything, and the process then stops itself. So wait for
 * the catalog to be complete instead of for a moment in time.
 *
 * @param {import("@iobroker/testing").TestHarness} harness
 */
async function feedFixtures(harness) {
    const deadline = Date.now() + 60000;
    for (;;) {
        const objects = await dumpObjects(harness);
        if (Object.keys(objects).length >= EXPECTED_OBJECTS) {
            return;
        }
        if (Date.now() > deadline) {
            assert.fail(
                `only ${Object.keys(objects).length} of ${EXPECTED_OBJECTS} objects appeared within 60 s`,
            );
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

/**
 * Adapter-specific config the fixtures need. A country is required — without one the adapter
 * warns and stops before writing anything. DE/BY exercises the state level as well; the object
 * catalog itself does not depend on it, which is what keeps two runs byte-identical.
 */
const FIXTURE_NATIVE = {
    country: "DE",
    state: "BY",
    region: "",
    typePublic: true,
    typeBank: false,
    typeSchool: false,
    typeOptional: false,
    typeObservance: false,
    excludeHolidays: [],
    includeBridgeDays: true,
};

async function dumpObjects(harness) {
    // The range starts at "<adapter>.0." — the instance root object itself is not part of the tree.
    const list = await harness.objects.getObjectList({ startkey: NS, endkey: `${NS}香` });
    const out = {};
    for (const row of list.rows.sort((a, b) => a.id.localeCompare(b.id))) {
        const obj = { ...row.value };
        for (const key of VOLATILE) delete obj[key];
        out[row.id] = obj;
    }
    return out;
}

tests.integration(ADAPTER_DIR, {
    defineAdditionalTests({ suite }) {
        suite("object inventory", getHarness => {
            let harness;
            before(async function () {
                this.timeout(120000);
                harness = getHarness();
                await harness.changeAdapterConfig(ADAPTER, { native: FIXTURE_NATIVE });
                await harness.startAdapterAndWait();
                await feedFixtures(harness);
            });

            it("writes test/objects.inventory.json", async function () {
                this.timeout(30000);
                const objects = await dumpObjects(harness);
                assert.ok(Object.keys(objects).length > 0, "no objects created — fixtures did not reach the adapter");
                fs.writeFileSync(INVENTORY, `${JSON.stringify(objects, null, 2)}\n`);
            });
        });

        const previousFile = process.env.INVENTORY_PREVIOUS;
        if (previousFile && fs.existsSync(previousFile)) {
            suite("upgrade from the previous release", getHarness => {
                let harness;
                const previous = JSON.parse(fs.readFileSync(previousFile, "utf8"));
                before(async function () {
                    this.timeout(120000);
                    harness = getHarness();
                    // The harness registers its own before() (fresh DB) ahead of this one,
                    // so the seed survives and the adapter starts on top of the OLD objects.
                    for (const [id, obj] of Object.entries(previous)) {
                        await harness.objects.setObjectAsync(id, obj);
                    }
                    await harness.changeAdapterConfig(ADAPTER, { native: FIXTURE_NATIVE });
                    await harness.startAdapterAndWait();
                    await feedFixtures(harness);
                });

                it("every current object carries the current texts and roles", async function () {
                    this.timeout(30000);
                    const current = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
                    const live = await dumpObjects(harness);
                    const stale = [];
                    for (const [id, obj] of Object.entries(current)) {
                        const got = live[id];
                        if (!got) { stale.push(`${id}: missing after upgrade`); continue; }
                        for (const f of COMPARED) {
                            if (JSON.stringify(got.common?.[f]) !== JSON.stringify(obj.common?.[f])) {
                                stale.push(`${id}: ${f} still ${JSON.stringify(got.common?.[f])}`);
                            }
                        }
                    }
                    assert.deepStrictEqual(stale, [], "objects an update did not reach:\n" + stale.join("\n"));
                });

                it("objects the release removed are gone (no leftovers)", async function () {
                    this.timeout(30000);
                    const current = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
                    const live = await dumpObjects(harness);
                    const leftovers = Object.keys(previous).filter(id => !(id in current) && id in live);
                    assert.deepStrictEqual(leftovers, [], "leftover objects:\n" + leftovers.join("\n"));
                });
            });
        }
    },
});
