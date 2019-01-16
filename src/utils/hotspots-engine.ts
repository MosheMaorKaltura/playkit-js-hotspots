
import { log } from './logger';
import { HotspotData } from "./hotspotData";
import { isNumber } from "util";

enum ChangeTypes {
    Show = 'show',
    Hide = 'hide'
}

type ChangeData = { time: number, type: ChangeTypes, cuePoint: HotspotData}

const reasonableSeekThreshold = 2000;

export class HotspotsEngine {
    private isFirstTime = true;
    private lastHandledTime: number | null = null;
    private lastHandledTimeIndex: number | null = null;
    private nextTimeToHandle: number | null = null;
    private hotspotsChanges: ChangeData[] = [];

        constructor(private hotspots: HotspotData[]) {
        log('debug', 'ctor', 'executed');
        this.prepareHotspots();
    }

    public getSnapshot(time: number) : HotspotData[] {
        const timeIndex = this.findClosestLastIndexByTime(time);
        log('debug', 'getSnapshot', `create snapshot based on time ${time}`, {timeIndex});
        return this.createHotspotsSnapshot(timeIndex);
    }

    public updateTime(currentTime: number, forceSnapshot = false): { snapshot?: HotspotData[], delta?: {show: HotspotData[], hide: HotspotData[]}} {
        const { isFirstTime, lastHandledTime, nextTimeToHandle } = this;

        if (this.hotspotsChanges.length === 0) {
            if (isFirstTime) {
                log('log', 'updateTime', `hotspots list empty. will always return empty snapshot`);
                this.isFirstTime = false;
            }
            return { snapshot: [] }
        }

        const userSeeked = !isFirstTime && lastHandledTime !== null && nextTimeToHandle !== null && (lastHandledTime > currentTime || (currentTime - nextTimeToHandle) > reasonableSeekThreshold);
        const hasChangesToHandle = isFirstTime || (this.lastHandledTime !== null  && this.lastHandledTime > currentTime) ||  (this.nextTimeToHandle != null && currentTime >= this.nextTimeToHandle);
        const closestChangeIndex = this.findClosestLastIndexByTime(currentTime);
        const closestChangeTime = closestChangeIndex < 0 ? 0 : this.hotspotsChanges[closestChangeIndex].time;

        if (!hasChangesToHandle) {
            // log('log', 'updateTime', `new time is between handled time and next time to handle, assume no delta`);

            if (forceSnapshot) {
                return { snapshot: this.createHotspotsSnapshot(closestChangeIndex)};
            }

            return { delta: this.createEmptyDelta() };
        }

        log('debug', 'updateTime', `has changes to handle. check if need to return snapshot instead of delta based on provided new time`,
            {currentTime, closestChangeIndex, closestChangeTime, lastHandledTime, nextTimeToHandle, isFirstTime });

        if (isFirstTime || forceSnapshot || userSeeked) {
            log('debug', 'updateTime', `some conditions doesn't allow returning delta, return snapshot instead`,
                { isFirstTime, userSeeked, forceSnapshot });

            const snapshot = this.createHotspotsSnapshot(closestChangeIndex);
            this.updateInternals(closestChangeTime, closestChangeIndex);

            return { snapshot };
        }

        const delta = this.createHotspotsDelta(closestChangeIndex);
        this.updateInternals(closestChangeTime, closestChangeIndex);

        return { delta };
    }

    private createHotspotsSnapshot(targetIndex: number) : HotspotData[] {
        if (targetIndex < 0 || !this.hotspotsChanges || this.hotspotsChanges.length === 0) {
            log('log', 'createHotspotsSnapshot', `resulted with empty snapshot`);
            return [];
        }

        const snapshot: HotspotData[] = [];

        for (let index = 0; index <= targetIndex; index++) {
            const item = this.hotspotsChanges[index];
            const hotspotIndex = snapshot.indexOf(item.cuePoint);
            if (item.type === ChangeTypes.Show) {
                if (hotspotIndex === -1) {
                    snapshot.push(item.cuePoint);
                }
            } else {
                if (hotspotIndex !== -1) {
                    snapshot.splice(hotspotIndex, 1);
                }
            }
        }

        log('log', 'createHotspotsSnapshot', 'resulted snapshot', { snapshot });
        return snapshot;
    }

    private createHotspotsDelta(targetIndex: number) {
        if (!this.hotspotsChanges || this.hotspotsChanges.length === 0) {
            log('log', 'createHotspotsDelta', `resulted with empty delta`);
            return this.createEmptyDelta();
        }

      const { lastHandledTimeIndex } = this;

      if (lastHandledTimeIndex === null) {
          log('log', 'createHotspotsDelta', `invalid internal state. resulted with empty delta`);
          return this.createEmptyDelta();
        }

        const newHotspots: HotspotData[] = [];
        const removedHotspots: HotspotData[] = [];

        log('log', 'createHotspotsDelta', `find hotspots that were added or removed`);
        for (let index = lastHandledTimeIndex+1; index <= targetIndex; index++) {
            const item = this.hotspotsChanges[index];
            const hotspotIndex = newHotspots.indexOf(item.cuePoint);
            if (item.type === ChangeTypes.Show) {
                if (hotspotIndex === -1) {
                    newHotspots.push(item.cuePoint);
                }
            } else {
                if (hotspotIndex !== -1) {
                    log('log', 'createHotspotsDelta', `hotspot was marked with type ${item.type} at ${item.time}. remove from new hotspots list as it wasn't visible yet`,
                        { hotspot: item.cuePoint });
                    newHotspots.splice(hotspotIndex, 1);
                } else if (removedHotspots.indexOf(item.cuePoint) === -1) {
                    log('log', 'createHotspotsDelta', `hotspot was marked with type ${item.type} at ${item.time}. add to removed hotspots list`,
                        { hotspot: item.cuePoint });
                    removedHotspots.push(item.cuePoint);
                }
            }
        }

        log('log', 'createHotspotsDelta', 'resulted delta', { newHotspots, removedHotspots });
        return { show: newHotspots, hide: removedHotspots};
    }

    private updateInternals(time: number, timeIndex: number) {
        const {hotspotsChanges} = this;

        if (!hotspotsChanges || hotspotsChanges.length === 0) {
            return;
        }

        const isIndexOfLastChange = timeIndex >= hotspotsChanges.length - 1;
        const isIndexBeforeTheFirstChange = timeIndex === null;
        this.lastHandledTime = time;
        this.lastHandledTimeIndex = timeIndex;
        this.nextTimeToHandle = isIndexBeforeTheFirstChange ? hotspotsChanges[0].time :
            isIndexOfLastChange ? hotspotsChanges[hotspotsChanges.length - 1].time :
                hotspotsChanges[timeIndex + 1].time;
        this.isFirstTime = false;
        log('debug', 'updateInternals', `update inner state with new time and index`,
            {
                lastHandledTime: this.lastHandledTime,
                lastHandledTimeIndex: this.lastHandledTimeIndex,
                nextTimeToHandle: this.nextTimeToHandle
            });
    }

    private createEmptyDelta(): {show: HotspotData[], hide: HotspotData[]} {
        return {show: [], hide: []};
    }

    private binarySearch(items: ChangeData[], value: number): number | null {

        if (!items || items.length === 0) {
            // empty array, no index to return
            return null;
        }

        if (value < items[0].time) {
            // value less then the first item. return -1
            return -1;
        }
        if (value > items[items.length - 1].time) {
            // value bigger then the last item, return last item index
            return items.length - 1;
        }

        let lo = 0;
        let hi = items.length - 1;

        while (lo <= hi) {
            let mid = Math.floor((hi + lo + 1) / 2);

            if (value < items[mid].time) {
                hi = mid - 1;
            } else if (value > items[mid].time) {
                lo = mid + 1;
            } else {
                return mid;
            }
        }

        return Math.min(lo, hi); // return the lowest index which represent the last visual item
    }

    private findClosestLastIndexByTime(time: number): number {
        const changes = this.hotspotsChanges;
        let closestIndex = this.binarySearch(changes, time);

        if (closestIndex === null) {
            return -1;
        }

        const changesLength = changes.length;
        while (closestIndex < changesLength-1 && changes[closestIndex+1].time === time)
        {
            closestIndex++;
        }

        return closestIndex;
    }

    private prepareHotspots() {
        (this.hotspots || []).forEach(hotspot => {

          if (hotspot.startTime !== null && typeof hotspot.startTime !== 'undefined' && hotspot.startTime >= 0) {
            this.hotspotsChanges.push(
              {
                time: hotspot.startTime,
                type: ChangeTypes.Show,
                cuePoint: hotspot
              }
            )
          }

          if (hotspot.endTime !== null && typeof hotspot.endTime !== 'undefined' && hotspot.endTime >= 0) {
            this.hotspotsChanges.push(
                    {
                        time: hotspot.endTime,
                        type: ChangeTypes.Hide,
                        cuePoint: hotspot
                    }
                )
            }
        });

        this.hotspotsChanges.sort((a,b) => {
            return a.time < b.time ? -1 : a.time === b.time ? 0 : 1
        });

        log('debug', 'prepareHotspots', `tracking ${this.hotspotsChanges.length} changes`, this.hotspotsChanges);
    }


}
