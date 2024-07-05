import { IgApiClient } from 'instagram-private-api';
import dotenv from 'dotenv';
import redis from 'redis';
import { promisify } from 'util';
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

    // Get the user ID of the account you are interested in
    const armanId = await ig.user.getIdByUsername("armansu");
    const armanFollowingsFeed = ig.feed.accountFollowing(armanId);

    let allFollowings = [];
    let nextPage = true;
    let page = 0;

    // Loop through pages of followings
    while (nextPage) {
      page += 1;
      console.log(`Fetching page number ${page}`);

      let currentPage = [];
      let retries = 0;
      const maxRetries = 3; // Maximum retries for handling errors

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

      // Add the current page of followings to the list
      allFollowings = allFollowings.concat(currentPage);

      console.log(`Fetched ${currentPage.length} followings in page ${page}`);
    }

    // Store all followings in Redis
    try {
      const allFollowingsData = JSON.stringify(allFollowings);
      await redisSetAsync('all_followings', allFollowingsData);
      console.log('All followings have been stored in Redis');
    } catch (redisError) {
      console.log('Error storing all followings in Redis:', redisError);
    }

    console.log('Done fetching followings.');
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
