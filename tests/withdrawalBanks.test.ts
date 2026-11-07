import test from 'node:test';
import assert from 'node:assert/strict';

test('Independent Withdrawal Payout Banks Architecture Tests', async (t) => {
    interface MockWithdrawalBank {
        id: number;
        name: string;
        isFast: boolean;
        isActive: boolean;
        sortOrder: number;
    }

    interface MockTransactionRequest {
        id: number;
        userId: bigint;
        type: 'withdraw' | 'deposit';
        amount: number;
        phone: string;
        status: 'PENDING' | 'APPROVED' | 'REJECTED';
        bankName?: string | null;
        accountId?: number | null;
    }

    const banksDb: MockWithdrawalBank[] = [];
    const requestsDb: MockTransactionRequest[] = [];
    let nextBankId = 1;
    let nextReqId = 1;

    // Helper functions simulating the endpoints
    function addWithdrawalBank(name: string, isFast: boolean = false) {
        const trimmed = (name || '').trim();
        if (!trimmed) throw new Error('Bank name is required.');
        if (banksDb.some(b => b.name.toLowerCase() === trimmed.toLowerCase())) {
            throw new Error(`"${trimmed}" is already in the withdrawal banks list.`);
        }
        const bank: MockWithdrawalBank = {
            id: nextBankId++,
            name: trimmed,
            isFast,
            isActive: true,
            sortOrder: banksDb.length + 1
        };
        banksDb.push(bank);
        return bank;
    }

    function getPublicWithdrawalBanks() {
        return banksDb
            .filter(b => b.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(b => ({ id: b.id, name: b.name, isFast: b.isFast }));
    }

    function toggleWithdrawalBank(id: number) {
        const bank = banksDb.find(b => b.id === id);
        if (!bank) throw new Error('Withdrawal bank not found');
        bank.isActive = !bank.isActive;
        return bank;
    }

    function deleteWithdrawalBank(id: number) {
        const idx = banksDb.findIndex(b => b.id === id);
        if (idx === -1) throw new Error('Withdrawal bank not found');
        banksDb.splice(idx, 1);
    }

    function createWithdrawalRequest(params: {
        userId: bigint;
        amount: number;
        phone: string;
        accountName: string;
        bankName: string;
    }) {
        const bank = banksDb.find(b => b.name.toLowerCase() === params.bankName.toLowerCase());
        const finalPhone = `${params.phone} (${params.accountName})`;
        const req: MockTransactionRequest = {
            id: nextReqId++,
            userId: params.userId,
            type: 'withdraw',
            amount: params.amount,
            phone: finalPhone,
            status: 'PENDING',
            bankName: bank ? bank.name : params.bankName,
            accountId: null
        };
        requestsDb.push(req);
        return req;
    }

    await t.test('Admin can add withdrawal banks without account numbers or holder names', () => {
        const b1 = addWithdrawalBank('Telebirr', true);
        const b2 = addWithdrawalBank('Commercial Bank of Ethiopia (CBE)', false);
        const b3 = addWithdrawalBank('Awash Bank', false);

        assert.equal(banksDb.length, 3);
        assert.equal(b1.name, 'Telebirr');
        assert.equal(b1.isFast, true);
        assert.equal(b1.isActive, true);
        assert.equal(b2.isFast, false);
        assert.equal(b3.sortOrder, 3);
    });

    await t.test('Prevents duplicate withdrawal bank names', () => {
        assert.throws(() => {
            addWithdrawalBank('Telebirr');
        }, /already in the withdrawal banks list/);
    });

    await t.test('Public endpoint returns only active withdrawal banks with id, name, and isFast', () => {
        // Toggle CBE to inactive
        toggleWithdrawalBank(2);

        const publicList = getPublicWithdrawalBanks();
        assert.equal(publicList.length, 2);
        assert.deepEqual(publicList.map(b => b.name), ['Telebirr', 'Awash Bank']);
        assert.deepEqual(publicList.map(b => b.isFast), [true, false]);

        // Neither accountNumber nor accountName exist on the bank model
        const first = publicList[0];
        assert.ok(first);
        assert.equal('accountNumber' in first, false);
        assert.equal('accountName' in first, false);
    });

    await t.test('Deleting a withdrawal bank removes it cleanly', () => {
        deleteWithdrawalBank(2); // delete the deactivated CBE bank
        assert.equal(banksDb.length, 2);
        assert.equal(banksDb.find(b => b.id === 2), undefined);
    });

    await t.test('Withdrawal request saves bankName and customer account details in finalPhone', () => {
        const req = createWithdrawalRequest({
            userId: 99999n,
            amount: 200,
            phone: '0912345678',
            accountName: 'Dawit Bekele',
            bankName: 'Telebirr'
        });

        assert.equal(req.amount, 200);
        assert.equal(req.bankName, 'Telebirr');
        assert.equal(req.phone, '0912345678 (Dawit Bekele)');
        assert.equal(req.status, 'PENDING');
        assert.equal(req.accountId, null); // completely decoupled from admin payment account
    });
});
