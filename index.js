import { IgApiClient } from 'instagram-private-api';
import dotenv from 'dotenv';
import redis from 'redis';
import { promisify } from 'util';
import { randomInt } from 'crypto';

dotenv.config();

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
});

const redisSetAsync = promisify(redisClient.set).bind(redisClient);

const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME);

const sleep = promisify(setTimeout);

let result = 0;

(async () => {
  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
    process.nextTick(async () => await ig.simulate.postLoginFlow());

    const armanId = await ig.user.getIdByUsername('armansu');
    const armanFollowingsFeed = ig.feed.accountFollowing(armanId);

    let allFollowings = [];
    let nextPage = true;
    let page = 0;
    let userCount = 0;

    while (nextPage) {
      //add there another try catchers
      page += 1;
      console.log(`Page num ${page}`);
      try{
        const currentPage = await armanFollowingsFeed.items();
      }catch (err){
        nextPage = armanFollowingsFeed.isMoreAvailable();
      }
      allFollowings = allFollowings.concat(currentPage);

      for (const user of currentPage) {
        try {
          const storyFeed = ig.feed.userStory(user.pk);
          const userStories = await storyFeed.items();

          if (userStories.length > 0) {
            console.log(`Stories of ${user.username}`);
            userStories.forEach(story => {
              console.log(`- Story ID: ${story.id}, Media Type: ${story.media_type}`);
              if (story.media_type === 1) {
                console.log(`  Image URL: ${story.image_versions2.candidates[0].url}`);
                result += 8;
              } else if (story.media_type === 2) {
                console.log(`  Video URL: ${story.video_versions[0].url}`);
                result += story.video_duration;
              }
            });
          }

          userCount += 1;

          if (userCount % 20 === 0) {
            try {
              await redisSetAsync(`story_result_${userCount}`, result);
              console.log(`Stored result in Redis for ${userCount} users: ${result}`);
            } catch (redisError) {
              console.error(`Error storing result in Redis for user ${user.username}:`, redisError);
            }
          }

          const randomSleep = randomInt(1000, 10000);
          console.log(`Sleeping for ${randomSleep} ms...`);
          await sleep(randomSleep);

        } catch (storyError) {
          console.error(`Error fetching stories for user ${user.username}:`, storyError);
        }
      }

      nextPage = armanFollowingsFeed.isMoreAvailable();
    }

    allFollowings.forEach(user => {
      console.log(`${user.username} (ID: ${user.pk})`);
    });

    try {
      await redisSetAsync(`story_result_${userCount}`, result);
      console.log(`Final stored result in Redis for ${userCount} users: ${result}`);
    } catch (finalRedisError) {
      console.error(`Error storing final result in Redis:`, finalRedisError);
    }

    console.log(`Sum of all story metrics: ${result}`);
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    redisClient.quit();
  }
})();
