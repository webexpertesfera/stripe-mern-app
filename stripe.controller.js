const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeService = require('../../services/v1/stripe.service');
const catchAsync = require('../../utils/catchAsync');
const globalService = require('../../services/v1/global.service');
const User = require('../../models/user.model');
const Payment = require('../../models/payment.model');
const Coupon = require('../../models/coupon.model');
const ApiError = require('../../utils/ApiError');
const httpStatus = require('http-status');
const emailService = require("../../services/v1/email.service")
const URL = process.env.FRONTEND_URL;

const checkoutSession = catchAsync(async (req, res) => {
    const { amount, interval, subscriptionId, ownerId } = req.body;
    const price = await stripeService.createStripePrice(amount, interval);
    const session = await stripeService.createCheckoutSession(URL, price, subscriptionId, ownerId);
    return res.status(200).json({
        status: 200,
        url: session?.url
    })
});

const createPortalSession = catchAsync(async (req, res) => {
    const { session_id } = req.body;
    const portalSession = await stripeService.stripePortal(session_id);
    return res.status(200).json({
        status: 200,
        url: portalSession?.url
    })
});

const webHook = (request, response) => {
    console.log('web hook api triggered')
    let event = request.body;
    // Replace this endpoint secret with your endpoint's unique secret
    // If you are testing with the CLI, find the secret by running 'stripe listen'
    // If you are using an endpoint defined with the API or dashboard, look in your webhook settings
    // at https://dashboard.stripe.com/webhooks
    const endpointSecret = 'whsec_12345';
    // Only verify the event if you have an endpoint secret defined.
    // Otherwise use the basic event deserialized with JSON.parse
    if (endpointSecret) {
        // Get the signature sent by Stripe
        const signature = request.headers['stripe-signature'];
        try {
            event = stripe.webhooks.constructEvent(
                request.body,
                signature,
                endpointSecret
            );
        } catch (err) {
            console.log(`⚠️  Webhook signature verification failed.`, err.message);
            return response.sendStatus(400);
        }
    }
    let subscription;
    let status;
    // Handle the event
    switch (event.type) {
        case 'customer.subscription.trial_will_end':
            subscription = event.data.object;
            status = subscription.status;
            console.log(`Subscription status is ${status}.`);
            // Then define and call a method to handle the subscription trial ending.
            // handleSubscriptionTrialEnding(subscription);
            break;
        case 'customer.subscription.deleted':
            subscription = event.data.object;
            status = subscription.status;
            console.log(`Subscription status is ${status}.`);
            // Then define and call a method to handle the subscription deleted.
            // handleSubscriptionDeleted(subscriptionDeleted);
            break;
        case 'customer.subscription.created':
            subscription = event.data.object;
            status = subscription.status;
            console.log(`Subscription status is ${status}.`);
            // Then define and call a method to handle the subscription created.
            // handleSubscriptionCreated(subscription);
            break;
        case 'customer.subscription.updated':
            subscription = event.data.object;
            status = subscription.status;
            console.log(`Subscription status is ${status}.`);
            // Then define and call a method to handle the subscription update.
            // handleSubscriptionUpdated(subscription);
            break;
        case 'entitlements.active_entitlement_summary.updated':
            subscription = event.data.object;
            console.log(`Active entitlement summary updated for ${subscription}.`);
            // Then define and call a method to handle active entitlement summary updated
            // handleEntitlementUpdated(subscription);
            break;
        default:
            // Unexpected event type
            console.log(`Unhandled event type ${event.type}.`);
    }
    // Return a 200 response to acknowledge receipt of the event
    response.send();
};

const subscriptionPaymentSuccess = catchAsync(async (req, res) => {
    const isOwnerExist = await globalService.checkAlreadyInUse(User, req.query.owner_id, '_id');
    if (!isOwnerExist) {
        return res.status(400).json({
            status: 400,
            message: `Owner not found`
        })
    }
    const success = await stripeService.subscriptionSuccess(req.query);
    console.log(success, 'success')
    const paymentId = success?.paymentUniqueId;
    const plan = success?.subscriptionId?.name;
    const price = success?.finalAmount;
    const ownerId = success?.ownerId;
    await emailService.sendPaymentSucess(isOwnerExist.email, isOwnerExist.firstName, success?.finalAmount, success?.subscriptionId?.name, success.planType, success?.createdAt)
    return res.redirect(`${URL}/owner/plan-success?paymentId=${paymentId}&plan=${plan}&price=${price}&ownerId=${ownerId}`)
});

const savePlan = catchAsync(async (req, res) => {
    const {
        ownerId,
        planType,
        planBasePrice,
        finalAmount,
        subscriptionId,
        code
    } = req.body;
    let amountBeforeDiscount = finalAmount
    let amountAfterDiscount = finalAmount;
    const owner = await globalService.checkAlreadyInUse(User, ownerId, '_id');
    if (!owner) {
        return res.status(400).json({ status: 400, message: 'Invalid Owner Id' })
    }
    if (owner?.role !== 'owner') {
        return res.status(400).json({ status: 400, message: 'Incorrect role' })
    }
    if (code) {
        const { amount, couponId } = await stripeService.applyCoupon(req.body, owner?.couponId);
        amountAfterDiscount = amount;
        owner.couponId = couponId;
    }
    owner.planType = planType;
    owner.planBasePrice = planBasePrice;
    owner.finalAmount = amountAfterDiscount;
    owner.totalAmount = amountBeforeDiscount;
    owner.subscriptionId = subscriptionId;
    // owner.planExpiryDate = stripeService.planExpiry(planType);
    // owner.planStartDate = globalService.UTCDateAndTime()
    await owner.save();
    return res.status(200).json({ status: 200, message: 'Plan saved successfuly' })
})

const applyCoupon = catchAsync(
    async (req, res) => {
        try {
            const { code, planType, ownerId } = req.body;
            const coupon = await Coupon.findOne({ code });
            const owner = await globalService.checkAlreadyInUse(User, ownerId, '_id');
            if (!coupon) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid coupon code')
            }
            if (coupon?.couponType !== "both" && coupon?.couponType !== planType) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid coupon type')
            }
            if (coupon?.couponUsedLimit === coupon?.couponUsed) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon usage limit exceeds')
            }
            if (coupon?.status === 'inactive') {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon is no longer available to use')
            }
            if (stripeService.isCouponExpired(coupon)) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon was expired')
            }
            owner.couponId = coupon?._id
            await owner.save()
            return res.status(200).json({ status: 200, message: 'Coupon Applied successfuly', data: coupon})
        } catch (error) {
            console.log(error)
            return res.status(500).json({
                status: 500,
                message: error.message,
                stack: error.stack
            })
        }
    }
)
module.exports = {
    checkoutSession,
    createPortalSession,
    webHook,
    subscriptionPaymentSuccess,
    savePlan,
    applyCoupon
}