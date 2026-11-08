# Talk track

<!-- Generated from server/src/logData.js by `npm run talk-track`. Do not edit by hand. -->

## Say this first

Everything on this screen is simulated: seeded log lines for twelve sources and a mock store. The formats are illustrative. What is measured is the pipeline lesson, taken from the AI-DEMO2 monitoring stack.

## One sign-in, three products

Search the client id. One sign-in shows up in PingOne, PingFederate and the gateway. That shared id is the whole join; without it you are lining up clocks.

## A burst, not a blip

Press Simulate burst. Eight failed sign-ins in two minutes and the rule fires. Two stray failures an hour never would.

## Why a ratio

Look at the gateway 401s: lots of them, nothing is wrong. A spec-following client starts every session with one. So this lab's gateway rule uses a ratio of 5xx with a traffic floor, not a count of rejections.

## The silent failure

Open the Label lab and turn the relabel rule off. Nothing errors. Every query returns nothing. The only rule that notices is the one that watches for silence.

## Mock and Real

Mock is the default and needs nothing. Real reads one Loki on this machine, read-only, if you configured it; otherwise the button explains why it is off.

## What is not claimed

The line shapes are illustrative and labelled UNVERIFIED. This lab does not claim to match any product version.

## The scenarios

1. **Follow one sign-in across three products.** One shared id is the whole join. Search the client id and a single sign-in appears in PingOne, PingFederate and the gateway, in time order. Without a shared id you can only line up clocks.
2. **A burst of failed sign-ins.** Two stray failures an hour are noise. Eight in two minutes from one user is the rule firing. The rule counts lines, so the count is only as good as the filter.
3. **The 401s that are not an outage.** Measured in AI-DEMO2: a spec-following MCP client starts every session with a 401 to discover the authorization server, so rejections run near 1:1 with successes while everything works. A rule on "any 401" would fire forever and be muted within a day.
4. **The gateway really is failing.** Now 5xx responses are most of the traffic and there is enough traffic to trust the ratio. The traffic floor is what stops one failed probe on an idle route from paging someone.
5. **Everything went quiet.** Turn the relabel rule off and the container names reach the store with a slash and a prefix, so every query by service name returns nothing, with no error. Measured in AI-DEMO2 (config.docker.alloy): leaving the stack prefix on made every container-log panel silently empty. The leading slash is this lab's own extension of that lesson.
6. **Privilege sensor, MCP gateway and agent gateway, same label scheme.** Two more sources reach the store the same way: the collector turns a container name into a service label. These two shapes were measured from a running AI-DEMO2 stack; they carry no shared id, so unlike the three-product sign-in they cannot be joined, only searched.
