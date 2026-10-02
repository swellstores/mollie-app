<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a; max-width: 560px;">
  <p>A shopper paid <strong>{{ amount_display }}</strong> with Mollie, but the app couldn't create their order automatically.</p>

  <p><strong>Why:</strong> {{ note }}</p>

  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr>
      <td style="padding: 4px 16px 4px 0; color: #666;">Mollie payment</td>
      <td style="padding: 4px 0;">{{ mollie_id }}</td>
    </tr>
    {% if cart.account.email %}
    <tr>
      <td style="padding: 4px 16px 4px 0; color: #666;">Shopper</td>
      <td style="padding: 4px 0;">{% if cart.account.name %}{{ cart.account.name }}, {% endif %}{{ cart.account.email }}</td>
    </tr>
    {% endif %}
  </table>

  <p><strong>What to do:</strong> create the order by hand in your Swell dashboard, or refund the shopper in Mollie. Then open <em>Orders → Mollie payments</em>, find this payment under <em>Needs attention</em> and set its outcome to <em>Resolved</em>.</p>

  {% if mollie_url %}
  <p><a href="{{ mollie_url }}" style="color: #0a66c2;">Open the payment in Mollie</a></p>
  {% endif %}
</div>
