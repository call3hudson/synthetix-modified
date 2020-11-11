const fs = require('fs');
const path = require('path');
const { contract, config } = require('@nomiclabs/buidler');
const { wrap } = require('../../index.js');
const { assert } = require('../contracts/common');
const { toUnit, fastForward } = require('../utils')();
const {
	detectNetworkName,
	connectContracts,
	ensureAccountHasEther,
	ensureAccountHassUSD,
	exchangeSynths,
	skipWaitingPeriod,
	bootstrapLocal,
	simulateExchangeRates,
	takeDebtSnapshot,
} = require('./utils');
const { toBytes32 } = require('../..');

contract('ExchangeRates (prod tests)', accounts => {
	const [, user] = accounts;

	let owner, oracle;

	let network, deploymentPath;

	let ExchangeRates, AddressResolver, SystemSettings, Exchanger;

	before('prepare', async () => {
		network = await detectNetworkName();
		const { getUsers, getPathToNetwork } = wrap({ network, fs, path });

		[owner, , , oracle] = getUsers({ network }).map(user => user.address);

		deploymentPath = config.deploymentPath || getPathToNetwork(network);

		if (network === 'local') {
			await bootstrapLocal({ deploymentPath });
		} else {
			if (config.simulateExchangeRates) {
				await ensureAccountHasEther({
					amount: toUnit('2'),
					account: oracle,
					fromAccount: accounts[7],
					network,
					deploymentPath,
				});

				await simulateExchangeRates({ deploymentPath, network, oracle });
				await takeDebtSnapshot({ deploymentPath, network });
			}
		}

		({ ExchangeRates, AddressResolver, SystemSettings, Exchanger } = await connectContracts({
			network,
			deploymentPath,
			requests: [
				{ contractName: 'ExchangeRates' },
				{ contractName: 'AddressResolver' },
				{ contractName: 'SystemSettings' },
				{ contractName: 'Exchanger' },
			],
		}));

		await skipWaitingPeriod({ network, deploymentPath });

		await ensureAccountHasEther({
			amount: toUnit('10'),
			account: owner,
			fromAccount: accounts[7],
			network,
			deploymentPath,
		});
		await ensureAccountHassUSD({
			amount: toUnit('1000'),
			account: user,
			fromAccount: owner,
			network,
			deploymentPath,
		});
	});

	describe('misc state', () => {
		it('has the expected resolver set', async () => {
			assert.equal(await ExchangeRates.resolver(), AddressResolver.address);
		});

		it('has the expected owner set', async () => {
			assert.equal(await ExchangeRates.owner(), owner);
		});
	});

	describe('when an exchange is made', () => {
		let waitingPeriod;
		before(async () => {
			await exchangeSynths({
				network,
				deploymentPath,
				account: user,
				fromCurrency: 'sUSD',
				toCurrency: 'sETH',
				amount: toUnit('10'),
			});
			waitingPeriod = Number(await SystemSettings.waitingPeriodSecs());
		});
		it('should settle', async () => {
			await fastForward(waitingPeriod);
			await Exchanger.settle(user, toBytes32('sETH'), { from: user });
		});
	});
});
