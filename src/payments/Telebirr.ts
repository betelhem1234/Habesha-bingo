import { config } from '../config';

export class TelebirrService {
    /**
     * MOCK Telebirr H5/App Web Payment Integration
     * In a real app, this generates an RSA-encrypted payload and calls Telebirr APIs.
     */
    static async generatePaymentUrl(userId: bigint, amount: number): Promise<string> {
        // MOCK: Generate a fake unique order number
        const orderNo = `TB-${Date.now()}-${userId}`;
        
        console.log(`[Telebirr] Creating payment request for ${amount} Birr (Order: ${orderNo})`);
        
        // Return a mock URL.
        // In a real integration, this is the 'toPayUrl' returned by Telebirr.
        return `https://app.telebirr.et/pay?order=${orderNo}&amount=${amount}`;
    }

    /**
     * MOCK Telebirr B2C (Business to Customer) API
     * Sends money directly to the user's phone number.
     */
    static async processWithdrawal(userId: bigint, phone: string, amount: number): Promise<boolean> {
        console.log(`[Telebirr] Sending ${amount} Birr to phone ${phone} for user ${userId}`);
        
        // Assume it succeeds for this mock.
        // In a real application, you would handle HTTP failures, insufficient merchant balance, etc.
        return true;
    }
}
