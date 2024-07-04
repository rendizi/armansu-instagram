import { IgApiClient } from 'instagram-private-api';
import dotenv from 'dotenv';
import redis from 'redis';
import { promisify } from 'util';
import { randomInt } from 'crypto';
import { log } from 'console';

dotenv.config();

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
});

// Promisify Redis set command
const redisSetAsync = promisify(redisClient.set).bind(redisClient);

// Instagram client setup
const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME);

// Promisify sleep function
const sleep = promisify(setTimeout);

let result = 0; // Variable to accumulate story metrics

(async () => {
  try {
    // Handle Redis connection errors
    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    console.log('Connecting to Redis...');

    // Instagram login flow
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
    process.nextTick(async () => await ig.simulate.postLoginFlow());
    console.log(`Logged in as ${loggedInUser.username}`);

    const armanId = await ig.user.getIdByUsername("armansu");
    const armanFollowingsFeed = ig.feed.accountFollowing(armanId);

    let allFollowings = [];
    let nextPage = true;
    let page = 0;
    let userCount = 0;
    const maxRetries = 3; // Maximum retries for handling errors

    // Loop through pages of followings
    while (nextPage) {
      page += 1;
      console.log(`Fetching page number ${page}`);

      let currentPage = [];
      let retries = 0;

      while (retries < maxRetries) {
        try {
          currentPage = await armanFollowingsFeed.items();
          nextPage = armanFollowingsFeed.isMoreAvailable();
          break;

        } catch (err) {
          console.log(`Error fetching followings for page ${page}:`, err);
          retries += 1;

          if (retries >= maxRetries) {
            console.log(`Max retries reached. Stopping pagination after ${page} pages.`);
            nextPage = false; // Stop pagination after maximum retries
          } else {
            console.log(`Retrying... (attempt ${retries} of ${maxRetries})`);
            await sleep(5000 * retries); // Exponential backoff for retry
          }
        }
      }

      allFollowings = allFollowings.concat(currentPage);

      for (const user of currentPage) {
        try {
          if (user.is_private){
            continue
          }
          console.log(user)
          const storyFeed = ig.feed.userStory(user.pk);
          console.log(storyFeed)
          const userStories = await storyFeed.items();
          console.log(userStories)

          if (userStories && userStories.length > 0) {
            console.log(`Stories of ${user.username}`);
            userStories.forEach(story => {
              console.log(`- Story ID: ${story.id}, Media Type: ${story.media_type}`);
              if (story.media_type === 1 && story.image_versions2) {
                console.log(`  Image URL: ${story.image_versions2.candidates[0].url}`);
                result += 8; // Arbitrary metric for images
              } else if (story.media_type === 2 && story.video_versions) {
                console.log(`  Video URL: ${story.video_versions[0].url}`);
                const viddur = story.video_duration || 0; // Metric for video duration
                result += viddur;
              }
            });
          }

          userCount += 1;

          // Store result in Redis every 20 users
          if (userCount % 20 === 0) {
            try {
              await redisSetAsync(`story_result_${userCount}`, result);
              console.log(`Stored result in Redis for ${userCount} users: ${result}`);
            } catch (redisError) {
              console.log(`Error storing result in Redis for user ${user.username}:`, redisError);
            }
          }

          // Sleep for a random duration to avoid rate limits
          const randomSleep = randomInt(1000, 10000);
          console.log(`Sleeping for ${randomSleep} ms...`);
          await sleep(randomSleep);

        } catch (storyError) {
          console.log(`Error fetching stories for user ${user.username}:`, storyError);
        }
      }
    }

    // Final storage of results in Redis
    try {
      await redisSetAsync(`story_result_${userCount}`, result);
      console.log(`Final stored result in Redis for ${userCount} users: ${result}`);
    } catch (finalRedisError) {
      console.log(`Error storing final result in Redis:`, finalRedisError);
    }

    console.log(`Sum of all story metrics: ${result}`);
  } catch (error) {
    console.log('An error occurred:', error);
  } finally {
    // Disconnect from Redis
    redisClient.quit((err) => {
      if (err) {
        console.log('Error disconnecting from Redis:', err);
      } else {
        console.log('Redis client disconnected');
      }
    });
  }
})();
