import ua from 'universal-analytics';

const visitor = ua(process.env.GA_ACCOUNT);

export default visitor;
