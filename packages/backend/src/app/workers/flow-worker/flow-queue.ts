import { Queue } from "bullmq";
import { ApId } from "@activepieces/shared";
import { createRedisClient } from "../../database/redis-connection";
import { ActivepiecesError, ErrorCode } from "@activepieces/shared";
import { OneTimeJobData, RepeatableJobData } from "./job-data";
import { logger } from "packages/backend/src/main";

interface BaseAddParams {
  id: ApId;
}

interface RepeatableJobAddParams extends BaseAddParams {
  data: RepeatableJobData;
  cronExpression: string;
}

interface OneTimeJobAddParams extends BaseAddParams {
  data: OneTimeJobData;
}

type AddParams = OneTimeJobAddParams | RepeatableJobAddParams;

interface RemoveParams {
  id: ApId;
  repeatable: boolean;
}

const JOB_REMOVAL_FAILURE = 0;

export const ONE_TIME_JOB_QUEUE = "oneTimeJobs";
export const REPEATABLE_JOB_QUEUE = "repeatableJobs";

const oneTimeJobQueue = new Queue<OneTimeJobData, unknown, ApId>(ONE_TIME_JOB_QUEUE, {
  connection: createRedisClient(),
});

const repeatableJobQueue = new Queue<RepeatableJobData, unknown, ApId>(REPEATABLE_JOB_QUEUE, {
  connection: createRedisClient(),
});

const repeatableJobKey = (id: ApId): string => `activepieces:repeatJobKey:${id}`;

export const flowQueue = {
  async add(params: AddParams): Promise<void> {
    console.log("[flowQueue#add] params=", params);
    if (isRepeatable(params)) {
      const { id, data, cronExpression } = params;

      const job = await repeatableJobQueue.add(id, data, {
        jobId: id,
        repeat: {
          pattern: cronExpression,
        },
      });

      const client = await repeatableJobQueue.client;

      await client.set(repeatableJobKey(id), job.repeatJobKey);
    } else {
      const { id, data } = params;

      await oneTimeJobQueue.add(id, data, {
        jobId: id,
      });
    }
  },

  async remove({ id, repeatable }: RemoveParams): Promise<void> {
    if (repeatable) {
      const client = await repeatableJobQueue.client;
      const jobKey = await client.get(repeatableJobKey(id));

      if (jobKey === null) {
        // If the trigger activation failed, don't let the function fail. 
        // Just ignore the action. Log an error message indicating that the job with key "${jobKey}" couldn't be found, even though it should exist, and proceed to skip the deletion.
        logger.error(`Couldn't find job ${jobKey}, even though It should exists, skipping delete`);
      } else {

        const result = await repeatableJobQueue.removeRepeatableByKey(jobKey);
        await client.del(repeatableJobKey(id));

        if (!result) {
          throw new ActivepiecesError({
            code: ErrorCode.JOB_REMOVAL_FAILURE,
            params: {
              jobId: id,
            },
          });
        }
      }
    } else {
      const result = await oneTimeJobQueue.remove(id);

      console.log(`[flowQueue#remove]: result=${result}`);

      if (result === JOB_REMOVAL_FAILURE) {
        throw new ActivepiecesError({
          code: ErrorCode.JOB_REMOVAL_FAILURE,
          params: {
            jobId: id,
          },
        });
      }
    }
  },
};

const isRepeatable = (params: AddParams): params is RepeatableJobAddParams => {
  return (params as RepeatableJobAddParams).cronExpression !== undefined;
};
