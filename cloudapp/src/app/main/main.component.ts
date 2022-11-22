import { Subscription, forkJoin, Observable, of } from 'rxjs';
import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CloudAppRestService, CloudAppEventsService, 
  Entity, PageInfo, RestErrorResponse, HttpMethod, Request } from '@exlibris/exl-cloudapp-angular-lib';
import {  MatSelectionList, MatListOption, MatSelectionListChange } from '@angular/material/list';
import { HttpHeaders, HttpClient } from '@angular/common/http';
import { concatMap, map, catchError} from 'rxjs/operators';
import { PriceResponse, PlaceOrderResponse } from '../models/response';

@Component({
  selector: 'app-main',
  templateUrl: './main.component.html',
  styleUrls: ['./main.component.scss']
})
export class MainComponent implements OnInit, OnDestroy {
  @ViewChild('requests') requests: MatSelectionList;
  private pageLoad$: Subscription;
  loading = false;
  pricesLoaded = false;
  placeOrderEnded = false;
  pageEntities: Entity[];
  selectedEntities: Entity[];
  apiResult: any;
  showPlaceOrderSpinner = false;
  borrowingTaskList = false;
  requestIdToRequest = new Map();
  requestToPrice : Map<string,PriceResponse> = new Map<string,PriceResponse>();
  requestToOrder : Map<string,PlaceOrderResponse> = new Map<string,PlaceOrderResponse>();

  entities$: Observable<Entity[]> = this.eventsService.entities$

  constructor(
    private restService: CloudAppRestService,
    private eventsService: CloudAppEventsService,
    private http: HttpClient,
  ) { 

  }

  ngOnInit() {
    this.pageLoad$ = this.eventsService.onPageLoad(this.onPageLoad);
  }

  ngOnDestroy(): void {
  }

  onPageLoad = (pageInfo: PageInfo) => {
    this.pageEntities = pageInfo.entities;
    if ((this.pageEntities || []).length > 0 && this.pageEntities[0].type === 'BORROWING_REQUEST') {
      this.loadEntities();
      this.loadPrices();
    } 
  }

  loadEntities(){
    this.loading = true;
    let calls = [];
    this.pageEntities.forEach(entity => calls.push(this.restService.call(entity.link)));
    forkJoin(calls).subscribe({
      next: (s: any[])=>{
        s.forEach(result=>{
          if (isRestErrorResponse(result)) {
            console.log('Error retrieving request: ' + result.message);
          } else {
            this.requestIdToRequest.set(result.request_id, result);
          }
        })
      },
      complete: () => this.loading = false,
      error: error => {
        console.log(error);
        this.loading = false
      }      
    });
  }

  loadPrices(){
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma'] + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      let calls = [];      
      this.pageEntities.forEach(entity => calls.push(this.http.post<any>(url + "?op=Order_GetPriceEstimate2&requestId=" + entity.id, [], { headers }).pipe(
        map((res) => this.requestToPrice.set(res.requestId, res)), 
        catchError(e => of(e)))));
      return forkJoin(calls);
    })).subscribe({
      next: response => {
        // this.requests.forEach((element) => {
        //   this.requestToPrice.set(element.requestId, element);
        // });
      }, error: error => {
        console.log(error);
      }, complete: () => this.pricesLoaded = true
    });
  }
  
  onBulkPlaceOrderClicked(selectedOptions: MatListOption[]){
    let selectedRequests = selectedOptions.map(o => o.value);
    selectedRequests.forEach(entity => {
      let orderObject = new PlaceOrderResponse();
      orderObject.status = "loading";
      this.requestToOrder.set(entity.id, orderObject)
    });
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma'] + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      let calls = [];      
      selectedRequests.forEach(entity => calls.push(this.http.post<any>(url + "?op=Order_PlaceOrder2&requestId=" + entity.id, [], { headers }).pipe(
        map((res) => {
          this.updatePartner(res);
          res.status = "done";
          this.requestToOrder.set(res.requestId, res);
        }), 
          catchError(e => of(e)
        ))));
      return forkJoin(calls);
    })).subscribe({
      next: response => {

      }, error: error => {
        console.log(error);
      }, complete: () => this.placeOrderEnded = true
    });
  }

  onPlaceOrderClicked(event, entityId){
    event.preventDefault();
    event.stopPropagation();
    this.placeOrderEnded = false;
    let orderObject = new PlaceOrderResponse();
    orderObject.status = "loading";
    this.requestToOrder.set(entityId, orderObject);
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {
      let url = data.initData.urls['alma']  + "view/ReprintsDeskCloudApp";
      let authHeader = "Bearer " + data.authToken;
      const headers = new HttpHeaders({ 'Authorization': authHeader});
      return this.http.post<any>(url + "?op=Order_PlaceOrder2&requestId=" + entityId, [], { headers });
    })).subscribe({
      next: response => {
        this.updatePartner(response);
        response.status = "done";
        this.requestToOrder.set(response.requestId, response);
      }, error: error => {
        console.log(error);
      }
    });
  }

  updatePartner(placeOrderResponse : PlaceOrderResponse){
    forkJoin({ initData: this.eventsService.getInitData(), authToken: this.eventsService.getAuthToken() }).pipe(concatMap((data) => {

      let updateUrl = "/../../rapido-api/v1/user/exl_impl/resource-sharing-requests/" + placeOrderResponse.requestId + "?op=assign_request_to_partner&partner=Reprints_Desk&partner_request_id=" + placeOrderResponse.additionalId + "&partner_additional_id=" + placeOrderResponse.randomNumber;
      let priceObject = this.requestToPrice.get(placeOrderResponse.requestId);
      if(priceObject && priceObject.price){
        updateUrl += "&cost=" + priceObject.price;
      }
      let request : Request = {
      url: updateUrl,
      method: HttpMethod.POST
      };
      return this.restService.call(request);

    })).subscribe({
      next: response => {
        let r = response;
      }, error: error => {
        console.log(error);
        this.placeOrderEnded = true;
      }, complete: () => this.placeOrderEnded = true
    });
  }

  getEntityAuthor(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.author){
      return requestObject.author;
    }
    return "";
  }

  getEntityJournalTitle(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.journal_title){
      return requestObject.journal_title;
    }
    return "";
  }

  getEntityPublication(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.year){
      return requestObject.year;
    }
    return "";
  }

  getEntityPages(entityId){
    let requestObject = this.requestIdToRequest.get(entityId);
    if(requestObject && requestObject.pages){
      return requestObject.pages;
    }
    return "";
  }

  getEntityPrice(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.price){
      if(priceObject.price.length == 4){
        return priceObject.price + '0';
      }
      return priceObject.price;
    }
    return "-1";
  }

  getEntityPriceErrorMsg(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.errorMsg){
      return priceObject.errorMsg;
    }
    return "failed to calculate price";
  }

  hasPriceErrorMsg(entityId){
    let priceObject = this.requestToPrice.get(entityId);
    if(priceObject && priceObject.errorMsg){
      return true;
    }
    return false;
  }

  getEntityOrderSuccess(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && !orderObject.errorMsg){
      return true;
    }
    return false;
  }

  getEntityOrderStatus(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.status){
      return orderObject.status;
    }
    return "";
  }

  getEntityOrderErrorMsg(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.errorMsg){
      return orderObject.errorMsg;
    }
    return "faild to place order";
  }

  onSelectAllClicked(){
    this.requests.options.forEach(request => {
      if(this.isEnabled(request.value.id)){
        request.selected = true;
      }
    });
  }

  onSelectedChanged($event: MatSelectionListChange) {
    if(!this.isEnabled($event.option.value.id)){
      event.preventDefault();
      event.stopPropagation();
      $event.option.selected = false;
    }
  }

  isEnabled(requestId){
    let price = this.getEntityPrice(requestId);
    if(price && price != "-1"){
      return true;
    }
    return false;
  }

  getShowSubmitSpinner(entityId){
    let orderObject = this.requestToOrder.get(entityId);
    if(orderObject && orderObject.status == "loading"){
      return true;
    }
    return false;
  }

}

const isRestErrorResponse = (object: any): object is RestErrorResponse => 'error' in object;