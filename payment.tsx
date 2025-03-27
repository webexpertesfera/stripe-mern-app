import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useParams } from 'react-router-dom';
import { paymentcreate } from '../api/payment';
const Key = import.meta.env.STRIPE_PUBLIC_KEY as string;
const stripePromise = loadStripe(Key);

const PaymentForm = ({ clientSecret,paymentId }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [paymentSucceeded, setPaymentSucceeded] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setProcessing(true);
    setError(null);

    if (!stripe || !elements) {
      return;
    }


    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method:paymentId,
      
    //   payment_method: {
    //  card: elements.getElement(CardElement),
    //   },
      setup_future_usage: "off_session", // Ensure this is necessary for your use case
    });
console.log(paymentIntent,"paymentIntent")
    if (error) {
      setError(error.message);
      setProcessing(false);
    } else if (paymentIntent.status === 'succeeded') {
      setPaymentSucceeded(true);
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <CardElement />
      <button type="submit" disabled={!stripe || processing}>
        {processing ? 'Processing...' : 'Pay'}
      </button>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {paymentSucceeded && <div style={{ color: 'green' }}>Payment succeeded!</div>}
    </form>
  );
};

export default PaymentForm;


export const PaymentPage = () => {
  const { id } = useParams();
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentId, setpaymentId] = useState(null);

  useEffect(() => {
    const fetchClientSecret = async () => {
      const data = { amount: "50" };
      const response = await paymentcreate(id ?? '', data);
      console.log(response)
      setClientSecret(response.clientSecret);
      setpaymentId(response.pamyentMethod);
    };

    fetchClientSecret();
  }, [id]);

  return (
    <div>
      <h1>Complete Your Payment</h1>
      {clientSecret ? (
        <Elements stripe={stripePromise}>
          <PaymentForm clientSecret={clientSecret} paymentId={paymentId} />
        </Elements>
      ) : (
        <div>Loading...</div>
      )}
    </div>
  );
};

