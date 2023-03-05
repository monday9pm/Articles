const { HermesPoster } = require('hermes-poster')

const hp = new HermesPoster(
    'action-secret.conf',
    'action-articles.conf',
    'https://raw.githubusercontent.com/monday9pm/Articles/main'
);
hp.run();

console.log("Hello monday9pm articles !");