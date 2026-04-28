import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get("SEEDDREAM_API_KEY");
        
        if (!apiKey) {
            return Response.json({ error: 'SeedDream API key not configured' }, { status: 500 });
        }

        // Get account balance from SeedDream
        const response = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/account/balance', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return Response.json({ 
                error: 'Failed to fetch balance',
                details: errorData 
            }, { status: response.status });
        }

        const balanceData = await response.json();
        
        return Response.json({ 
            success: true,
            balance: balanceData
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});